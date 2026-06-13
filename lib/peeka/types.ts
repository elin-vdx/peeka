// Shared types for Peeka's manifest-based storage model.
//
// There is no database: each project+branch has a single manifest.json in R2
// that records its builds, per-snapshot diff results, and the current baselines.

export type ReviewState = "needs_review" | "approved" | "rejected"

// Outcome of diffing a snapshot against its baseline.
export type SnapshotStatus = "new" | "unchanged" | "changed"

// "failed" means the build has new/changed snapshots awaiting review.
export type BuildStatus = "pending" | "passed" | "failed"

export interface SnapshotResult {
  name: string // human label, e.g. "Design System/Button — Attention"
  variant: string // capture target, e.g. "chrome-large"
  key: string // slug used inside object keys
  newImageKey: string // snapshots/<project>/<commit>/<key>__<variant>.png
  baselineKey: string | null // baseline object key at build time (null if first-seen)
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

export interface Build {
  id: string
  commit: string
  branch: string
  createdAt: string // ISO timestamp
  github?: {
    owner: string
    repo: string
    sha: string
    prNumber?: number
  }
  status: BuildStatus
  snapshots: SnapshotResult[]
  summary: BuildSummary
}

export interface BaselineEntry {
  imageKey: string // baselines/<project>/<branch>/<key>__<variant>.png
  commit: string
  width: number
  height: number
  approvedAt: string
}

export interface BranchManifest {
  version: 1
  project: string
  branch: string
  updatedAt: string
  // Keyed by `${snapshotKey}::${variant}`.
  baselines: Record<string, BaselineEntry>
  builds: Build[] // newest first; capped to the most recent entries
}

// Maximum number of builds retained per branch manifest.
export const MAX_BUILDS = 50
