"use client"

import type { SnapshotResult } from "@/lib/peeka/types"
import { useState, useTransition } from "react"

type Tab = "side-by-side" | "diff" | "swipe"

function imgUrl(key: string | null): string | null {
  return key ? `/api/img?key=${encodeURIComponent(key)}` : null
}

export function SnapshotViewer({
  snapshot,
  onApprove,
  onReject,
}: {
  snapshot: SnapshotResult
  // Server actions bound to (project, branch, buildId, snapshotKey, variant).
  onApprove: () => Promise<void>
  onReject: () => Promise<void>
}) {
  const [tab, setTab] = useState<Tab>(
    snapshot.diffKey ? "side-by-side" : "side-by-side",
  )
  const [pending, startTransition] = useTransition()

  const baselineUrl = imgUrl(snapshot.baselineKey)
  const newUrl = imgUrl(snapshot.newImageKey)
  const diffUrl = imgUrl(snapshot.diffKey)

  const isNew = snapshot.status === "new"
  const isUnchanged = snapshot.status === "unchanged"
  const approved = snapshot.review === "approved"
  const rejected = snapshot.review === "rejected"

  return (
    <section className="rounded-lg border border-zinc-200 dark:border-zinc-800">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
        <div>
          <h3 className="font-medium">{snapshot.name}</h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {snapshot.variant}
            {!isNew && !isUnchanged && (
              <> · {snapshot.percent.toFixed(2)}% changed</>
            )}
            {isNew && <> · new</>}
            {isUnchanged && <> · unchanged</>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {!isNew && !isUnchanged && (
            <div className="flex overflow-hidden rounded-md border border-zinc-200 text-sm dark:border-zinc-700">
              {(["side-by-side", "diff", "swipe"] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-3 py-1 capitalize transition-colors ${
                    tab === t
                      ? "bg-zinc-900 text-white dark:bg-white dark:text-black"
                      : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  }`}
                >
                  {t.replace(/-/g, " ")}
                </button>
              ))}
            </div>
          )}
          {isUnchanged ? null : approved ? (
            <span className="text-sm font-medium text-green-600 dark:text-green-400">
              ✓ Approved
            </span>
          ) : (
            <div className="flex items-center gap-2">
              {rejected && (
                <span className="text-sm font-medium text-red-600 dark:text-red-400">
                  ✕ Rejected
                </span>
              )}
              <button
                disabled={pending}
                onClick={() => startTransition(() => onReject())}
                className="rounded-md border border-red-300 px-3 py-1 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
              >
                {pending ? "…" : "Reject"}
              </button>
              <button
                disabled={pending}
                onClick={() => startTransition(() => onApprove())}
                className="rounded-md bg-green-600 px-3 py-1 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50"
              >
                {pending ? "Approving…" : "Approve"}
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="bg-zinc-50 p-5 dark:bg-black">
        {isNew && newUrl && (
          <div className="flex justify-center">
            <Framed src={newUrl} alt="new snapshot" />
          </div>
        )}

        {!isNew && tab === "side-by-side" && (
          <div className="grid grid-cols-2 gap-4">
            <Labeled label="Baseline">
              {baselineUrl && <Framed src={baselineUrl} alt="baseline" />}
            </Labeled>
            <Labeled label="New">
              {newUrl && <Framed src={newUrl} alt="new" />}
            </Labeled>
          </div>
        )}

        {!isNew && tab === "diff" && (
          <div className="flex justify-center">
            {diffUrl ? (
              <Framed src={diffUrl} alt="diff" />
            ) : (
              <p className="text-sm text-zinc-500">
                No diff overlay (size mismatch or unchanged).
              </p>
            )}
          </div>
        )}

        {!isNew && tab === "swipe" && baselineUrl && newUrl && (
          <Swipe baselineUrl={baselineUrl} newUrl={newUrl} />
        )}
      </div>
    </section>
  )
}

function Framed({ src, alt }: { src: string; alt: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className="max-w-full border border-zinc-200 bg-white dark:border-zinc-700"
    />
  )
}

function Labeled({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      {children}
    </div>
  )
}

// Overlay the new image atop the baseline, clipped by a draggable slider.
function Swipe({
  baselineUrl,
  newUrl,
}: {
  baselineUrl: string
  newUrl: string
}) {
  const [pos, setPos] = useState(50)
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative inline-block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={baselineUrl}
          alt="baseline"
          className="block max-w-full border border-zinc-200 bg-white dark:border-zinc-700"
        />
        <div
          className="absolute inset-0 overflow-hidden"
          style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={newUrl}
            alt="new"
            className="block max-w-full border border-zinc-200 bg-white dark:border-zinc-700"
          />
        </div>
        <div
          className="pointer-events-none absolute inset-y-0 w-0.5 bg-pink-500"
          style={{ left: `${pos}%` }}
        />
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={pos}
        onChange={(e) => setPos(Number(e.target.value))}
        className="w-2/3"
        aria-label="swipe position"
      />
    </div>
  )
}
