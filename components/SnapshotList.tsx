"use client"

import type { SnapshotStatus } from "@/lib/peeka/types"
import { useState, type ReactNode } from "react"

export interface SnapshotListItem {
  id: string
  status: SnapshotStatus
  node: ReactNode // a server-rendered <SnapshotViewer>
}

const FILTERS: { status: SnapshotStatus; label: string }[] = [
  { status: "changed", label: "Changed" },
  { status: "new", label: "New" },
  { status: "unchanged", label: "Unchanged" },
]

export function SnapshotList({ items }: { items: SnapshotListItem[] }) {
  // Changed + new shown by default; unchanged hidden by default.
  const [visible, setVisible] = useState<Record<SnapshotStatus, boolean>>({
    changed: true,
    new: true,
    unchanged: false,
  })

  const counts = items.reduce(
    (acc, it) => {
      acc[it.status]++
      return acc
    },
    { new: 0, changed: 0, unchanged: 0 } as Record<SnapshotStatus, number>,
  )

  const shown = items.filter((it) => visible[it.status])

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-4 rounded-lg border border-zinc-200 px-4 py-3 text-sm dark:border-zinc-800">
        <span className="font-medium text-zinc-500">Show:</span>
        {FILTERS.map(({ status, label }) => (
          <label
            key={status}
            className="flex cursor-pointer items-center gap-2 select-none"
          >
            <input
              type="checkbox"
              checked={visible[status]}
              onChange={(e) =>
                setVisible((v) => ({ ...v, [status]: e.target.checked }))
              }
              className="h-4 w-4 accent-green-600"
            />
            {label}
            <span className="text-zinc-400">({counts[status]})</span>
          </label>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          No snapshots match the selected filters.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {shown.map((it) => (
            <div key={it.id}>{it.node}</div>
          ))}
        </div>
      )}
    </div>
  )
}
