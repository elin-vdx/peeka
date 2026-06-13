// Shared types for Peeka's manifest-based storage model.
//
// There is no database. Storage is many small objects in R2 rather than one
// growing mutable file, so concurrent ingests/approvals don't clobber:
//   - builds/<project>/<branch>/<buildId>.json        immutable-ish build record
//   - builds/.../<buildId>/chunk-<n>.json             write-once per diff worker
//   - baselines/.../<key>__<variant>.json             one file per baseline
//   - index/<project>/<branch>.json                   small list of recent builds

export type ReviewState = "needs_review" | "approved" | "rejected"

// Outcome of diffing a snapshot against its baseline.
export type SnapshotStatus = "new" | "unchanged" | "changed"

// "failed" = the build has new/changed snapshots awaiting review.
// "pending" = diffing not yet complete.
export type BuildStatus = "pending" | "passed" | "failed"

// A snapshot as recorded at ingest time, before diffing.
export interface SnapshotInput {
  name: string // human label, e.g. "Design System/Button — Attention"
  variant: string // capture target, e.g. "chrome-large"
  key: string // slug used inside object keys
  newImageKey: string // snapshots/<project>/<commit>/<key>__<variant>.png
}

// A snapshot after diffing against its baseline.
export interface SnapshotResult extends SnapshotInput {
  baselineKey: string | null // baseline image key at diff time (null if first-seen)
  diffKey: string | null // diffs/... (null when new or unchanged)
  width: number
  height: number
  status: SnapshotStatus
  mismatchedPixels: number
  totalPixels: number
  percent: number // 0..100
  review: ReviewState // only meaningful when status !== "unchanged"
}

export interface BuildSummary {
  total: number
  changed: number
  new: number
  unchanged: number
}

export interface BuildGithub {
  owner: string
  repo: string
  sha: string
  prNumber?: number
}

// The full build record (builds/<project>/<branch>/<buildId>.json).
export interface BuildRecord {
  id: string
  project: string
  branch: string
  commit: string
  createdAt: string // ISO
  github?: BuildGithub
  status: BuildStatus
  // When true, new/changed snapshots auto-promote to baseline on finalize
  // (set when the build's branch is the repo's default branch).
  autoBaseline: boolean
  chunkCount: number // number of diff-worker chunks for this build
  inputs: SnapshotInput[] // recorded at ingest, before diffing
  snapshots: SnapshotResult[] // filled in once diffing finalizes
  summary: BuildSummary
}

// Results produced by one diff worker chunk (builds/.../<buildId>/chunk-<n>.json).
export interface ChunkResult {
  chunk: number
  results: SnapshotResult[]
}

// One approved baseline (baselines/<project>/<branch>/<key>__<variant>.json).
export interface BaselineRecord {
  imageKey: string // baselines/<project>/<branch>/<key>__<variant>.png
  commit: string
  width: number
  height: number
  approvedAt: string
}

// A compact entry in the per-branch index (no per-snapshot detail).
export interface BuildIndexEntry {
  id: string
  branch: string
  commit: string
  createdAt: string
  status: BuildStatus
  summary: BuildSummary
}

// The small per-branch index (index/<project>/<branch>.json).
export interface BranchIndex {
  version: 2
  project: string
  branch: string
  updatedAt: string
  builds: BuildIndexEntry[] // newest first, capped
}

// Per-build review overrides, since the build record is large/immutable.
// Keyed by `${snapshotKey}::${variant}` → review state.
// (reviews/<project>/<branch>/<buildId>.json)
export type ReviewSidecar = Record<string, ReviewState>

// How many recent builds the per-branch index retains.
export const MAX_INDEX_BUILDS = 20

// Snapshots diffed per QStash chunk.
export const CHUNK_SIZE = 50
