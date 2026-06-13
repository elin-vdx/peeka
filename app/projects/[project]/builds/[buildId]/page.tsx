import { StatusBadge } from "@/components/StatusBadge"
import { SnapshotViewer } from "@/components/SnapshotViewer"
import { auth } from "@/auth"
import { getManifest, listBranches } from "@/lib/peeka/storage"
import type { Build } from "@/lib/peeka/types"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { approveAll, approveSnapshot } from "./actions"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export default async function BuildPage({
  params,
}: {
  params: Promise<{ project: string; buildId: string }>
}) {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const { project, buildId } = await params

  // The build's branch isn't in the URL, so scan branch manifests for it.
  const branches = await listBranches(project)
  let found: { branch: string; build: Build } | null = null
  for (const branch of branches) {
    const manifest = await getManifest(project, branch)
    const build = manifest?.builds.find((b) => b.id === buildId)
    if (build) {
      found = { branch, build }
      break
    }
  }
  if (!found) notFound()

  const { branch, build } = found
  const pendingCount = build.snapshots.filter(
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
            <StatusBadge status={build.status} />
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
        {build.snapshots.map((snap) => {
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
          return (
            <SnapshotViewer
              key={`${snap.key}::${snap.variant}`}
              snapshot={snap}
              onApprove={approve}
            />
          )
        })}
      </div>
    </div>
  )
}
