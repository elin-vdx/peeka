// Shared helpers for build state, used by both ingest and the approve actions.

import type { Build, BuildStatus, SnapshotResult } from "./types"

export function summarize(snapshots: SnapshotResult[]) {
  return {
    total: snapshots.length,
    changed: snapshots.filter((s) => s.status === "changed").length,
    new: snapshots.filter((s) => s.status === "new").length,
    unchanged: snapshots.filter((s) => s.status === "unchanged").length,
  }
}

// A build passes once nothing is still awaiting review.
export function computeStatus(snapshots: SnapshotResult[]): BuildStatus {
  const pending = snapshots.some(
    (s) => s.status !== "unchanged" && s.review === "needs_review",
  )
  return pending ? "failed" : "passed"
}

export function recomputeBuild(build: Build): Build {
  return {
    ...build,
    summary: summarize(build.snapshots),
    status: computeStatus(build.snapshots),
  }
}

export function reviewUrl(project: string, buildId: string): string {
  const base = process.env.APP_URL ?? "http://localhost:3000"
  return `${base}/projects/${encodeURIComponent(project)}/builds/${encodeURIComponent(buildId)}`
}
