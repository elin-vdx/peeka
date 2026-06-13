// QStash publishing wrapper. Each message tells the diff worker which chunk of
// a build to process. When QStash isn't configured (local dev), callers fall
// back to processing inline.

import { Client } from "@upstash/qstash"

export interface DiffJob {
  project: string
  branch: string
  defaultBranch: string
  buildId: string
  commit: string
  chunk: number
  inputs: import("./types").SnapshotInput[]
}

export function qstashConfigured(): boolean {
  return Boolean(process.env.QSTASH_TOKEN)
}

let client: Client | null = null
function qstash(): Client {
  if (!client) client = new Client({ token: process.env.QSTASH_TOKEN! })
  return client
}

// Publish one diff job to the worker endpoint. QStash retries on failure and
// signs the request so the worker can verify it.
export async function publishDiffJob(job: DiffJob): Promise<void> {
  const base = process.env.APP_URL ?? "http://localhost:3000"
  await qstash().publishJSON({
    url: `${base}/api/diff-worker`,
    body: job,
    retries: 3,
  })
}
