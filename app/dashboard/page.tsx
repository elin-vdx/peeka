import { auth, signOut } from "@/auth"

export default async function DashboardPage() {
  // proxy.ts already gates this route; we re-check here as the
  // authoritative server-side check (proxy checks are optimistic).
  const session = await auth()
  const user = session?.user

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 bg-zinc-50 dark:bg-black">
      <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
        Welcome{user?.name ? `, ${user.name}` : ""}
      </h1>
      <p className="text-zinc-600 dark:text-zinc-400">{user?.email}</p>
      <form
        action={async () => {
          "use server"
          await signOut({ redirectTo: "/login" })
        }}
      >
        <button
          type="submit"
          className="flex h-11 items-center justify-center rounded-full bg-foreground px-6 text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
        >
          Sign out
        </button>
      </form>
    </div>
  )
}
