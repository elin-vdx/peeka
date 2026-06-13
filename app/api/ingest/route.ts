// Machine-to-machine ingest endpoint. CI in other repos POSTs PNGs + metadata
// here. This route is under /api so it is NOT gated by proxy.ts; it is
// protected by a shared token instead.
//
// It stores uploads, writes a pending build record, and enqueues diff jobs
// (one QStash message per chunk). It returns immediately — diffing happens
// asynchronously in /api/diff-worker. When QStash is not configured, it
// processes inline so local dev still works.
//
// Body: multipart/form-data
//   project, branch, commit, owner, repo, sha, prNumber  (text fields)
//   meta        JSON: { "<filename>": { "name": "...", "variant": "..." }, ... }
//   snapshots   one or more PNG files (repeatable field)

import { timingSafeEqual } from "node:crypto"
import { chunk, reviewUrl } from "@/lib/peeka/build"
import { processChunk, tryFinalize } from "@/lib/peeka/process"
import { publishDiffJob, qstashConfigured } from "@/lib/peeka/queue"
import {
  putBuild,
  slug,
  snapshotKey as buildSnapshotKey,
  putObject,
} from "@/lib/peeka/storage"
import type { BuildRecord, SnapshotInput } from "@/lib/peeka/types"
import { CHUNK_SIZE } from "@/lib/peeka/types"

export const runtime = "nodejs"
export const maxDuration = 60

function authorized(req: Request): boolean {
  const expected = process.env.PEEKA_INGEST_TOKEN
  if (!expected) return false
  const header =
    req.headers.get("x-peeka-token") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    ""
  const a = Buffer.from(header)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

interface FileMeta {
  name: string
  variant: string
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 })
  }

  const form = await req.formData()
  const project = String(form.get("project") ?? "")
  const branch = String(form.get("branch") ?? "")
  const commit = String(form.get("commit") ?? "")
  if (!project || !branch || !commit) {
    return Response.json(
      { error: "project, branch and commit are required" },
      { status: 400 },
    )
  }

  const owner = String(form.get("owner") ?? "")
  const repo = String(form.get("repo") ?? "")
  const sha = String(form.get("sha") ?? commit)
  const prNumberRaw = form.get("prNumber")
  const prNumber = prNumberRaw ? Number(prNumberRaw) : undefined

  // When the build's branch is the repo's default branch, new/changed
  // snapshots auto-promote to baseline so PR branches have something to diff
  // against. Defaults to "main" if the CI doesn't send it.
  const defaultBranch = String(form.get("defaultBranch") ?? "main")
  const autoBaseline = slug(branch) === slug(defaultBranch)

  let meta: Record<string, FileMeta> = {}
  const metaRaw = form.get("meta")
  if (typeof metaRaw === "string" && metaRaw.trim()) {
    try {
      meta = JSON.parse(metaRaw)
    } catch {
      return Response.json({ error: "meta is not valid JSON" }, { status: 400 })
    }
  }

  const files = form
    .getAll("snapshots")
    .filter((f): f is File => f instanceof File)
  if (files.length === 0) {
    return Response.json({ error: "no snapshots provided" }, { status: 400 })
  }

  // Store every upload and record its input metadata (no diffing yet).
  const inputs: SnapshotInput[] = []
  for (const file of files) {
    const fileMeta = meta[file.name] ?? parseFilename(file.name)
    const name = fileMeta.name
    const variant = fileMeta.variant
    const newImageKey = buildSnapshotKey(project, commit, name, variant)
    await putObject(newImageKey, Buffer.from(await file.arrayBuffer()), "image/png")
    inputs.push({ name, variant, key: slug(name), newImageKey })
  }

  const buildId = `${slug(commit).slice(0, 8)}-${Date.now().toString(36)}`
  const chunks = chunk(inputs, CHUNK_SIZE)

  const build: BuildRecord = {
    id: buildId,
    project: slug(project),
    branch: slug(branch),
    commit,
    createdAt: new Date().toISOString(),
    github: owner && repo ? { owner, repo, sha, prNumber } : undefined,
    status: "pending",
    autoBaseline,
    chunkCount: chunks.length,
    inputs,
    snapshots: [],
    summary: { total: inputs.length, changed: 0, new: 0, unchanged: 0 },
  }
  await putBuild(build)

  // Fan out the diffing. With QStash, enqueue and return immediately. Without
  // it (local dev), process inline so the loop still completes.
  if (qstashConfigured()) {
    await Promise.all(
      chunks.map((inputsChunk, i) =>
        publishDiffJob({
          project,
          branch,
          buildId,
          commit,
          chunk: i,
          inputs: inputsChunk,
        }),
      ),
    )
  } else {
    for (let i = 0; i < chunks.length; i++) {
      await processChunk(project, branch, buildId, commit, i, chunks[i])
    }
    await tryFinalize(project, branch, buildId)
  }

  return Response.json({
    buildId,
    status: "pending",
    snapshots: inputs.length,
    chunks: chunks.length,
    mode: qstashConfigured() ? "async" : "inline",
    reviewUrl: reviewUrl(slug(project), buildId),
  })
}

// Fallback parser for "Some Name__chrome-large.png".
function parseFilename(filename: string): FileMeta {
  const base = filename.replace(/\.png$/i, "")
  const idx = base.lastIndexOf("__")
  if (idx === -1) return { name: base, variant: "default" }
  return { name: base.slice(0, idx), variant: base.slice(idx + 2) }
}
