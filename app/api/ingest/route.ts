// Machine-to-machine ingest endpoint. CI in other repos POSTs PNGs + metadata
// here. This route is under /api so it is NOT gated by proxy.ts; it is
// protected by a shared token instead.
//
// Body: multipart/form-data
//   project, branch, commit, owner, repo, sha, prNumber  (text fields)
//   meta        JSON: { "<filename>": { "name": "...", "variant": "..." }, ... }
//   snapshots   one or more PNG files (repeatable field)

import { timingSafeEqual } from "node:crypto"
import { recomputeBuild, reviewUrl, summarize } from "@/lib/peeka/build"
import { diffPngBuffers, readPngSize } from "@/lib/peeka/diff"
import { setCommitStatus } from "@/lib/peeka/github"
import {
  diffKey as buildDiffKey,
  getManifest,
  getObject,
  putManifest,
  putObject,
  slug,
  snapshotKey as buildSnapshotKey,
} from "@/lib/peeka/storage"
import type {
  BranchManifest,
  Build,
  SnapshotResult,
} from "@/lib/peeka/types"
import { MAX_BUILDS } from "@/lib/peeka/types"

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

  let meta: Record<string, FileMeta> = {}
  const metaRaw = form.get("meta")
  if (typeof metaRaw === "string" && metaRaw.trim()) {
    try {
      meta = JSON.parse(metaRaw)
    } catch {
      return Response.json({ error: "meta is not valid JSON" }, { status: 400 })
    }
  }

  const files = form.getAll("snapshots").filter((f): f is File => f instanceof File)
  if (files.length === 0) {
    return Response.json({ error: "no snapshots provided" }, { status: 400 })
  }

  // Load (or initialize) the per-branch manifest up front. We do all diffing
  // first and write the manifest exactly once at the end.
  const manifest: BranchManifest =
    (await getManifest(project, branch)) ??
    ({
      version: 1,
      project: slug(project),
      branch: slug(branch),
      updatedAt: new Date().toISOString(),
      baselines: {},
      builds: [],
    } satisfies BranchManifest)

  const results: SnapshotResult[] = []

  for (const file of files) {
    // Resolve the snapshot's human name + variant: explicit meta wins,
    // otherwise fall back to parsing "name__variant.png".
    const fileMeta = meta[file.name] ?? parseFilename(file.name)
    const name = fileMeta.name
    const variant = fileMeta.variant
    const key = slug(name)
    const baselineMapKey = `${key}::${slug(variant)}`

    const buf = Buffer.from(await file.arrayBuffer())
    const newImageKey = buildSnapshotKey(project, commit, name, variant)
    await putObject(newImageKey, buf, "image/png")

    const baseline = manifest.baselines[baselineMapKey]

    if (!baseline) {
      const { width, height } = readPngSize(buf)
      results.push({
        name,
        variant,
        key,
        newImageKey,
        baselineKey: null,
        diffKey: null,
        width,
        height,
        status: "new",
        mismatchedPixels: 0,
        totalPixels: width * height,
        percent: 0,
        review: "needs_review",
      })
      continue
    }

    const baselineBuf = await getObject(baseline.imageKey)
    if (!baselineBuf) {
      // Manifest referenced a baseline that's gone; treat as new.
      const { width, height } = readPngSize(buf)
      results.push({
        name,
        variant,
        key,
        newImageKey,
        baselineKey: null,
        diffKey: null,
        width,
        height,
        status: "new",
        mismatchedPixels: 0,
        totalPixels: width * height,
        percent: 0,
        review: "needs_review",
      })
      continue
    }

    const diff = diffPngBuffers(baselineBuf, buf)
    const changed = diff.percent > 0
    let diffKeyValue: string | null = null
    if (changed && diff.diffPng) {
      diffKeyValue = buildDiffKey(project, commit, name, variant)
      await putObject(diffKeyValue, diff.diffPng, "image/png")
    }

    results.push({
      name,
      variant,
      key,
      newImageKey,
      baselineKey: baseline.imageKey,
      diffKey: diffKeyValue,
      width: diff.width,
      height: diff.height,
      status: changed ? "changed" : "unchanged",
      mismatchedPixels: diff.mismatchedPixels,
      totalPixels: diff.totalPixels,
      percent: diff.percent,
      review: changed ? "needs_review" : "approved",
    })
  }

  const buildId = `${slug(commit).slice(0, 8)}-${Date.now().toString(36)}`
  const build: Build = recomputeBuild({
    id: buildId,
    commit,
    branch: slug(branch),
    createdAt: new Date().toISOString(),
    github: owner && repo ? { owner, repo, sha, prNumber } : undefined,
    status: "pending",
    snapshots: results,
    summary: summarize(results),
  })

  manifest.builds = [build, ...manifest.builds].slice(0, MAX_BUILDS)
  manifest.updatedAt = new Date().toISOString()
  await putManifest(manifest)

  // Reflect the outcome on the PR (best-effort).
  if (owner && repo) {
    const passed = build.status === "passed"
    await setCommitStatus(
      owner,
      repo,
      sha,
      passed ? "success" : "failure",
      reviewUrl(slug(project), buildId),
      passed
        ? "No visual changes"
        : `${build.summary.changed} changed, ${build.summary.new} new — review required`,
    )
  }

  return Response.json({
    buildId,
    status: build.status,
    summary: build.summary,
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
