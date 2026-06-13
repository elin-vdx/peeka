// Core diffing + finalize logic, shared by the diff worker route and the
// inline fallback used in local dev (when QStash isn't configured).

import { computeStatus, reviewUrl, summarize } from "./build"
import { diffPngBuffers, readPngSize } from "./diff"
import { setCommitStatus } from "./github"
import {
  baselineImageKey,
  copyObject,
  countDone,
  diffKey as buildDiffKey,
  getBaseline,
  getBuild,
  getChunk,
  getObject,
  markChunkDone,
  pairKey,
  putBaseline,
  putBuild,
  putChunk,
  putObject,
  slug,
  updateIndex,
} from "./storage"
import type {
  BuildRecord,
  ChunkResult,
  SnapshotInput,
  SnapshotResult,
} from "./types"

// Resolve the baseline for a snapshot: prefer the build's own branch, then
// fall back to the default branch (so PR branches diff against main).
async function resolveBaseline(
  project: string,
  branch: string,
  defaultBranch: string,
  name: string,
  variant: string,
) {
  const own = await getBaseline(project, branch, name, variant)
  if (own) return own
  if (slug(branch) !== slug(defaultBranch)) {
    return getBaseline(project, defaultBranch, name, variant)
  }
  return null
}

// Diff one chunk of a build and persist its results + done marker.
export async function processChunk(
  project: string,
  branch: string,
  defaultBranch: string,
  buildId: string,
  commit: string,
  chunkIndex: number,
  inputs: SnapshotInput[],
): Promise<void> {
  const results: SnapshotResult[] = []

  for (const input of inputs) {
    const newBuf = await getObject(input.newImageKey)
    if (!newBuf) {
      // Upload missing (shouldn't happen) — skip defensively.
      continue
    }

    const baseline = await resolveBaseline(
      project,
      branch,
      defaultBranch,
      input.name,
      input.variant,
    )

    if (!baseline) {
      const { width, height } = readPngSize(newBuf)
      results.push({
        ...input,
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
      const { width, height } = readPngSize(newBuf)
      results.push({
        ...input,
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

    const diff = diffPngBuffers(baselineBuf, newBuf)
    const changed = diff.percent > 0
    let diffKeyValue: string | null = null
    if (changed && diff.diffPng) {
      diffKeyValue = buildDiffKey(project, commit, input.name, input.variant)
      await putObject(diffKeyValue, diff.diffPng, "image/png")
    }

    results.push({
      ...input,
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

  const chunkResult: ChunkResult = { chunk: chunkIndex, results }
  await putChunk(project, branch, buildId, chunkResult)
  await markChunkDone(project, branch, buildId, chunkIndex)
}

// Assemble all chunk results into the build record once every chunk is done.
// Idempotent: safe to call from multiple workers; only finalizes when complete.
export async function tryFinalize(
  project: string,
  branch: string,
  buildId: string,
): Promise<boolean> {
  const build = await getBuild(project, branch, buildId)
  if (!build) return false
  if (build.status !== "pending") return true // already finalized

  const done = await countDone(project, branch, buildId)
  if (done < build.chunkCount) return false

  // Gather every chunk's results.
  const all: SnapshotResult[] = []
  for (let i = 0; i < build.chunkCount; i++) {
    const c = await getChunk(project, branch, buildId, i)
    if (!c) return false // a chunk's results aren't written yet; bail
    all.push(...c.results)
  }

  // On the default branch, auto-promote new/changed snapshots to baseline so
  // PR branches have something to diff against. This mutates `all` in place so
  // the persisted build reflects the approved state.
  if (build.autoBaseline) {
    for (const snap of all) {
      if (snap.status === "unchanged") continue
      const dest = baselineImageKey(project, branch, snap.name, snap.variant)
      await copyObject(snap.newImageKey, dest)
      await putBaseline(project, branch, snap.name, snap.variant, {
        imageKey: dest,
        commit: snap.newImageKey.split("/")[2] ?? "",
        width: snap.width,
        height: snap.height,
        approvedAt: new Date().toISOString(),
      })
      snap.review = "approved"
    }
  }

  const finalized: BuildRecord = {
    ...build,
    snapshots: all,
    summary: summarize(all),
    status: computeStatus(all),
  }
  await putBuild(finalized)

  // Update the small per-branch index (upsert by id, newest first, capped).
  await updateIndex(project, branch, (index) => {
    const entry = {
      id: finalized.id,
      branch: finalized.branch,
      commit: finalized.commit,
      createdAt: finalized.createdAt,
      status: finalized.status,
      summary: finalized.summary,
    }
    const others = index.builds.filter((b) => b.id !== entry.id)
    const builds = [entry, ...others]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, 20)
    return { ...index, builds }
  })

  // Reflect the outcome on the PR (best-effort).
  if (finalized.github) {
    const { owner, repo, sha } = finalized.github
    const passed = finalized.status === "passed"
    await setCommitStatus(
      owner,
      repo,
      sha,
      passed ? "success" : "failure",
      reviewUrl(slug(project), buildId),
      passed
        ? "No visual changes"
        : `${finalized.summary.changed} changed, ${finalized.summary.new} new — review required`,
    )
  }

  return true
}

// Build a `${key}::${variant}` pair key for a snapshot input/result.
export function snapPairKey(s: { key: string; variant: string }): string {
  return pairKey(s.key, s.variant)
}
