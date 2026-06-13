import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { auth } from "@/auth"

// In this version of Next.js the `middleware` convention was renamed to
// `proxy`. We read the Auth.js session and gate the protected routes.
const protectedRoutes = ["/", "/dashboard"]

export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname
  const isProtected = protectedRoutes.some((route) =>
    route === "/" ? path === "/" : path === route || path.startsWith(`${route}/`)
  )

  if (!isProtected) {
    return NextResponse.next()
  }

  const session = await auth()
  if (!session?.user) {
    const loginUrl = new URL("/login", req.nextUrl)
    loginUrl.searchParams.set("callbackUrl", req.nextUrl.pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  // Run on everything except static assets, image optimization, and the
  // auth API routes (which must stay reachable for the OAuth flow).
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
}
