// Shared helpers for build state, used by ingest, the diff worker, and the
// approve actions.

import type { BuildStatus, SnapshotResult } from "./types"

export function summarize(snapshots: SnapshotResult[]) {
  return {
    total: snapshots.length,
    changed: snapshots.filter((s) => s.status === "changed").length,
    new: snapshots.filter((s) => s.status === "new").length,
    unchanged: snapshots.filter((s) => s.status === "unchanged").length,
  }
}

// A build passes only when every new/changed snapshot has been approved.
// Unchanged snapshots never block; a snapshot left needs_review OR rejected
// keeps the build failed (so a rejection stays unsuccessful on GitHub).
export function computeStatus(snapshots: SnapshotResult[]): BuildStatus {
  const blocked = snapshots.some(
    (s) => s.status !== "unchanged" && s.review !== "approved",
  )
  return blocked ? "failed" : "passed"
}

export function reviewUrl(project: string, buildId: string): string {
  const base = process.env.APP_URL ?? "http://localhost:3000"
  return `${base}/projects/${encodeURIComponent(project)}/builds/${encodeURIComponent(buildId)}`
}

// Build the per-chunk slices of an array.
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
