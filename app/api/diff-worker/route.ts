// QStash delivers one diff job here per chunk. We verify the QStash signature,
// diff the chunk, then attempt to finalize the build (idempotent). This route
// is under /api, so proxy.ts does not gate it — the signature is the auth.

import { processChunk, tryFinalize } from "@/lib/peeka/process"
import type { DiffJob } from "@/lib/peeka/queue"
import { Receiver } from "@upstash/qstash"

export const runtime = "nodejs"
export const maxDuration = 300

let receiver: Receiver | null = null
function getReceiver(): Receiver | null {
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY
  if (!currentSigningKey || !nextSigningKey) return null
  if (!receiver) {
    receiver = new Receiver({ currentSigningKey, nextSigningKey })
  }
  return receiver
}

export async function POST(req: Request) {
  const body = await req.text()

  // Verify the QStash signature when signing keys are configured.
  const r = getReceiver()
  if (r) {
    const signature = req.headers.get("upstash-signature") ?? ""
    const valid = await r
      .verify({ signature, body })
      .catch(() => false)
    if (!valid) {
      return Response.json({ error: "invalid signature" }, { status: 401 })
    }
  } else if (process.env.NODE_ENV === "production") {
    // Refuse unsigned calls in production.
    return Response.json({ error: "signature verification not configured" }, { status: 401 })
  }

  let job: DiffJob
  try {
    job = JSON.parse(body)
  } catch {
    return Response.json({ error: "bad job payload" }, { status: 400 })
  }

  const { project, branch, buildId, commit, chunk, inputs } = job
  await processChunk(project, branch, buildId, commit, chunk, inputs)
  const finalized = await tryFinalize(project, branch, buildId)

  return Response.json({ ok: true, chunk, finalized })
}
