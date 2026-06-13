import { auth } from "@/auth"
import { listProjects } from "@/lib/peeka/storage"
import Link from "next/link"
import { redirect } from "next/navigation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export default async function ProjectsPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const projects = await listProjects()

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-12">
      <h1 className="mb-8 text-2xl font-semibold tracking-tight">Projects</h1>
      {projects.length === 0 ? (
        <p className="text-zinc-500 dark:text-zinc-400">
          No projects yet. Push snapshots to{" "}
          <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-sm dark:bg-zinc-800">
            POST /api/ingest
          </code>{" "}
          to create one.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {projects.map((p) => (
            <li key={p}>
              <Link
                href={`/projects/${encodeURIComponent(p)}`}
                className="block rounded-lg border border-zinc-200 px-5 py-4 font-medium transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
              >
                {p}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
