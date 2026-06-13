import { StatusBadge } from "@/components/StatusBadge"
import { auth } from "@/auth"
import { getIndex, listBranches } from "@/lib/peeka/storage"
import type { BuildIndexEntry } from "@/lib/peeka/types"
import Link from "next/link"
import { redirect } from "next/navigation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ project: string }>
}) {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const { project } = await params
  const branches = await listBranches(project)

  // Read the small per-branch indexes and merge their build entries.
  const indexes = await Promise.all(branches.map((b) => getIndex(project, b)))
  const builds: BuildIndexEntry[] = indexes
    .flatMap((idx) => idx?.builds ?? [])
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-12">
      <Link
        href="/projects"
        className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
      >
        ← Projects
      </Link>
      <h1 className="mb-8 mt-2 text-2xl font-semibold tracking-tight">
        {project}
      </h1>

      {builds.length === 0 ? (
        <p className="text-zinc-500 dark:text-zinc-400">No builds yet.</p>
      ) : (
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {builds.map((b) => (
            <li key={b.id}>
              <Link
                href={`/projects/${encodeURIComponent(project)}/builds/${b.id}`}
                className="flex items-center justify-between gap-4 py-4 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{b.branch}</span>
                    <span className="font-mono text-xs text-zinc-500">
                      {b.commit.slice(0, 8)}
                    </span>
                  </div>
                  <div className="text-sm text-zinc-500 dark:text-zinc-400">
                    {b.summary.changed} changed · {b.summary.new} new ·{" "}
                    {b.summary.unchanged} unchanged
                  </div>
                </div>
                <StatusBadge status={b.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
