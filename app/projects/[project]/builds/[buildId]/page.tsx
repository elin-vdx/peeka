import { StatusBadge } from "@/components/StatusBadge"
import { SnapshotViewer } from "@/components/SnapshotViewer"
import { auth } from "@/auth"
import { computeStatus } from "@/lib/peeka/build"
import {
  getBuild,
  getIndex,
  getReviewSidecar,
  listBranches,
  pairKey,
} from "@/lib/peeka/storage"
import type { BuildRecord, SnapshotResult } from "@/lib/peeka/types"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { approveAll, approveSnapshot, rejectSnapshot } from "./actions"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// The branch isn't in the URL; find it from the per-branch indexes (small).
async function findBranch(
  project: string,
  buildId: string,
): Promise<string | null> {
  const branches = await listBranches(project)
  const indexes = await Promise.all(
    branches.map(async (b) => ({ b, idx: await getIndex(project, b) })),
  )
  for (const { b, idx } of indexes) {
    if (idx?.builds.some((e) => e.id === buildId)) return b
  }
  return null
}

export default async function BuildPage({
  params,
}: {
  params: Promise<{ project: string; buildId: string }>
}) {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const { project, buildId } = await params
  const branch = await findBranch(project, buildId)
  if (!branch) notFound()

  const build = await getBuild(project, branch, buildId)
  if (!build) notFound()

  if (build.status === "pending") {
    return <Diffing project={project} build={build} />
  }

  // Overlay any per-build review overrides recorded since finalize.
  const sidecar = (await getReviewSidecar(project, branch, buildId)) ?? {}
  const snapshots: SnapshotResult[] = build.snapshots.map((s) => {
    const override = sidecar[pairKey(s.key, s.variant)]
    return override ? { ...s, review: override } : s
  })
  const status = computeStatus(snapshots)
  const pendingCount = snapshots.filter(
    (s) => s.status !== "unchanged" && s.review === "needs_review",
  ).length

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-12">
      <Link
        href={`/projects/${encodeURIComponent(project)}`}
        className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
      >
        ← {project}
      </Link>

      <div className="mb-8 mt-2 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight">
            {build.branch}
            <StatusBadge status={status} />
          </h1>
          <p className="font-mono text-sm text-zinc-500">
            {build.commit.slice(0, 12)} · {build.summary.changed} changed ·{" "}
            {build.summary.new} new · {build.summary.unchanged} unchanged
          </p>
        </div>
        {pendingCount > 0 && (
          <form
            action={async () => {
              "use server"
              await approveAll(project, branch, buildId)
            }}
          >
            <button
              type="submit"
              className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700"
            >
              Approve all ({pendingCount})
            </button>
          </form>
        )}
      </div>

      <div className="flex flex-col gap-6">
        {snapshots.map((snap) => {
          const approve = async () => {
            "use server"
            await approveSnapshot(
              project,
              branch,
              buildId,
              snap.key,
              snap.variant,
            )
          }
          const reject = async () => {
            "use server"
            await rejectSnapshot(
              project,
              branch,
              buildId,
              snap.key,
              snap.variant,
            )
          }
          return (
            <SnapshotViewer
              key={`${snap.key}::${snap.variant}`}
              snapshot={snap}
              onApprove={approve}
              onReject={reject}
            />
          )
        })}
      </div>
    </div>
  )
}

function Diffing({
  project,
  build,
}: {
  project: string
  build: BuildRecord
}) {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-12">
      <Link
        href={`/projects/${encodeURIComponent(project)}`}
        className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
      >
        ← {project}
      </Link>
      <h1 className="mb-2 mt-2 flex items-center gap-3 text-2xl font-semibold tracking-tight">
        {build.branch}
        <StatusBadge status="pending" />
      </h1>
      <p className="text-zinc-500 dark:text-zinc-400">
        Diffing {build.inputs.length} snapshots… refresh in a moment.
      </p>
    </div>
  )
}
