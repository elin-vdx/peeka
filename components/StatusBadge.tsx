import type { BuildStatus } from "@/lib/peeka/types"

const styles: Record<BuildStatus, string> = {
  passed:
    "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  pending:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
}

const labels: Record<BuildStatus, string> = {
  passed: "Passed",
  failed: "Needs review",
  pending: "Diffing…",
}

export function StatusBadge({ status }: { status: BuildStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status]}`}
    >
      {labels[status]}
    </span>
  )
}
