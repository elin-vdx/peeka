"use server"

// Promote a reviewed snapshot (or a whole build) to be the branch baseline.

import { auth } from "@/auth"
import { recomputeBuild, reviewUrl } from "@/lib/peeka/build"
import { setCommitStatus } from "@/lib/peeka/github"
import {
  baselineKey as buildBaselineKey,
  copyObject,
  getManifest,
  putManifest,
  slug,
} from "@/lib/peeka/storage"
import type { SnapshotResult } from "@/lib/peeka/types"
import { revalidatePath } from "next/cache"

async function requireUser() {
  const session = await auth()
  if (!session?.user) throw new Error("unauthorized")
}

// Copy a snapshot's new image to its branch-baseline key and record it in the
// manifest's baselines map. Mutates the passed snapshot in place.
async function promote(
  project: string,
  branch: string,
  baselines: Record<string, import("@/lib/peeka/types").BaselineEntry>,
  snap: SnapshotResult,
) {
  const dest = buildBaselineKey(project, branch, snap.name, snap.variant)
  await copyObject(snap.newImageKey, dest)
  baselines[`${snap.key}::${slug(snap.variant)}`] = {
    imageKey: dest,
    commit: snap.newImageKey.split("/")[2] ?? "",
    width: snap.width,
    height: snap.height,
    approvedAt: new Date().toISOString(),
  }
  snap.review = "approved"
}

export async function approveSnapshot(
  project: string,
  branch: string,
  buildId: string,
  snapshotKey: string,
  variant: string,
) {
  await requireUser()
  const manifest = await getManifest(project, branch)
  if (!manifest) throw new Error("manifest not found")
  const build = manifest.builds.find((b) => b.id === buildId)
  if (!build) throw new Error("build not found")
  const snap = build.snapshots.find(
    (s) => s.key === snapshotKey && slug(s.variant) === slug(variant),
  )
  if (!snap) throw new Error("snapshot not found")

  await promote(slug(project), slug(branch), manifest.baselines, snap)
  applyBuildStatus(manifest, build)
  manifest.updatedAt = new Date().toISOString()
  await putManifest(manifest)
  await maybeFlipGitHubStatus(slug(project), build)

  revalidatePath(`/projects/${project}/builds/${buildId}`)
}

export async function approveAll(
  project: string,
  branch: string,
  buildId: string,
) {
  await requireUser()
  const manifest = await getManifest(project, branch)
  if (!manifest) throw new Error("manifest not found")
  const build = manifest.builds.find((b) => b.id === buildId)
  if (!build) throw new Error("build not found")

  for (const snap of build.snapshots) {
    if (snap.status !== "unchanged" && snap.review === "needs_review") {
      await promote(slug(project), slug(branch), manifest.baselines, snap)
    }
  }
  applyBuildStatus(manifest, build)
  manifest.updatedAt = new Date().toISOString()
  await putManifest(manifest)
  await maybeFlipGitHubStatus(slug(project), build)

  revalidatePath(`/projects/${project}/builds/${buildId}`)
}

function applyBuildStatus(
  manifest: import("@/lib/peeka/types").BranchManifest,
  build: import("@/lib/peeka/types").Build,
) {
  const updated = recomputeBuild(build)
  build.status = updated.status
  build.summary = updated.summary
  manifest.builds = manifest.builds.map((b) => (b.id === build.id ? build : b))
}

async function maybeFlipGitHubStatus(
  project: string,
  build: import("@/lib/peeka/types").Build,
) {
  if (build.status === "passed" && build.github) {
    const { owner, repo, sha } = build.github
    await setCommitStatus(
      owner,
      repo,
      sha,
      "success",
      reviewUrl(project, build.id),
      "Visual changes approved",
    )
  }
}
