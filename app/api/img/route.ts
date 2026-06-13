// Auth-guarded proxy for private R2 objects. R2 stays private; the review UI
// references images through /api/img?key=... This route lives under /api, so
// proxy.ts does not gate it — we check the session inline.

import { auth } from "@/auth"
import { getObject, SERVABLE_PREFIXES } from "@/lib/peeka/storage"
import type { NextRequest } from "next/server"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return new Response("unauthorized", { status: 401 })
  }

  const key = req.nextUrl.searchParams.get("key")
  if (!key || !SERVABLE_PREFIXES.some((p) => key.startsWith(p))) {
    return new Response("bad key", { status: 400 })
  }

  const buf = await getObject(key)
  if (!buf) {
    return new Response("not found", { status: 404 })
  }

  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=300",
    },
  })
}
