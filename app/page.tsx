import { redirect } from "next/navigation"
import { auth } from "@/auth"

export default async function Home() {
  // proxy.ts gates this optimistically; this is the authoritative check.
  const session = await auth()
  if (!session?.user) {
    redirect("/login")
  }
  // The dashboard is the home of the app.
  redirect("/dashboard")
}
