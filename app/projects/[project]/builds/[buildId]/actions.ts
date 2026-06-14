"use server"

// Promote reviewed snapshots to be the branch baseline. Each baseline is its
// own object, so concurrent approvals never touch a shared file. Per-build
// review state is recorded in a small sidecar; the build's index status is
// updated once everything is approved.

import { auth } from "@/auth"
import { computeStatus, reviewUrl } from "@/lib/peeka/build"
import { setCommitStatus } from "@/lib/peeka/github"
import {
  baselineImageKey,
  copyObject,
  getBuild,
  getReviewSidecar,
  pairKey,
  putBaseline,
  putReviewSidecar,
  slug,
  updateIndex,
} from "@/lib/peeka/storage"
import type { BuildRecord, ReviewSidecar, SnapshotResult } from "@/lib/peeka/types"
import { revalidatePath } from "next/cache"

async function requireUser() {
  const session = await auth()
  if (!session?.user) throw new Error("unauthorized")
}

// Copy a snapshot's new image to its branch-baseline key and write the
// per-baseline metadata object.
async function promote(
  project: string,
  branch: string,
  snap: SnapshotResult,
) {
  const dest = baselineImageKey(project, branch, snap.name, snap.variant)
  await copyObject(snap.newImageKey, dest)
  await putBaseline(project, branch, snap.name, snap.variant, {
    imageKey: dest,
    commit: snap.newImageKey.split("/")[2] ?? "",
    width: snap.width,
    height: snap.height,
    approvedAt: new Date().toISOString(),
  })
}

// Recompute the build's status using the sidecar overrides and update the
// per-branch index entry.
async function syncIndexStatus(
  project: string,
  branch: string,
  build: BuildRecord,
  sidecar: ReviewSidecar,
) {
  const snapshots = build.snapshots.map((s) => {
    const override = sidecar[pairKey(s.key, s.variant)]
    return override ? { ...s, review: override } : s
  })
  const status = computeStatus(snapshots)
  await updateIndex(project, branch, (index) => ({
    ...index,
    builds: index.builds.map((e) =>
      e.id === build.id ? { ...e, status } : e,
    ),
  }))
  // Reflect the current state on the PR: green only when everything is
  // approved; otherwise keep it red (covers reject and partial approval).
  if (build.github) {
    const { owner, repo, sha } = build.github
    const passed = status === "passed"
    const rejected = snapshots.some(
      (s) => s.status !== "unchanged" && s.review === "rejected",
    )
    await setCommitStatus(
      owner,
      repo,
      sha,
      passed ? "success" : "failure",
      reviewUrl(slug(project), build.id),
      passed
        ? "Visual changes approved"
        : rejected
          ? "Visual changes rejected — review required"
          : "Visual changes need review",
    )
  }
}

export async function approveSnapshot(
  project: string,
  branch: string,
  buildId: string,
  snapshotKey: string,
  variant: string,
) {
  await requireUser()
  const build = await getBuild(project, branch, buildId)
  if (!build) throw new Error("build not found")
  const snap = build.snapshots.find(
    (s) => s.key === snapshotKey && slug(s.variant) === slug(variant),
  )
  if (!snap) throw new Error("snapshot not found")

  await promote(slug(project), slug(branch), snap)

  const sidecar = (await getReviewSidecar(project, branch, buildId)) ?? {}
  sidecar[pairKey(snapshotKey, variant)] = "approved"
  await putReviewSidecar(project, branch, buildId, sidecar)

  await syncIndexStatus(project, branch, build, sidecar)
  revalidatePath(`/projects/${project}/builds/${buildId}`)
}

export async function rejectSnapshot(
  project: string,
  branch: string,
  buildId: string,
  snapshotKey: string,
  variant: string,
) {
  await requireUser()
  const build = await getBuild(project, branch, buildId)
  if (!build) throw new Error("build not found")
  const snap = build.snapshots.find(
    (s) => s.key === snapshotKey && slug(s.variant) === slug(variant),
  )
  if (!snap) throw new Error("snapshot not found")

  // Reject does NOT promote a baseline; it just records the decision so the
  // build stays unsuccessful on GitHub.
  const sidecar = (await getReviewSidecar(project, branch, buildId)) ?? {}
  sidecar[pairKey(snapshotKey, variant)] = "rejected"
  await putReviewSidecar(project, branch, buildId, sidecar)

  await syncIndexStatus(project, branch, build, sidecar)
  revalidatePath(`/projects/${project}/builds/${buildId}`)
}

export async function approveAll(
  project: string,
  branch: string,
  buildId: string,
) {
  await requireUser()
  const build = await getBuild(project, branch, buildId)
  if (!build) throw new Error("build not found")

  const sidecar = (await getReviewSidecar(project, branch, buildId)) ?? {}
  for (const snap of build.snapshots) {
    const pk = pairKey(snap.key, snap.variant)
    if (snap.status !== "unchanged" && (sidecar[pk] ?? snap.review) === "needs_review") {
      await promote(slug(project), slug(branch), snap)
      sidecar[pk] = "approved"
    }
  }
  await putReviewSidecar(project, branch, buildId, sidecar)

  await syncIndexStatus(project, branch, build, sidecar)
  revalidatePath(`/projects/${project}/builds/${buildId}`)
}
