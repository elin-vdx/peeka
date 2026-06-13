// Posts a commit status to GitHub so a PR reflects the visual-review outcome.

export type CommitStatusState = "success" | "failure" | "pending" | "error"

// Best-effort: a GitHub hiccup must not fail ingest, so non-2xx is logged and
// swallowed. No-op when GITHUB_TOKEN is unset (e.g. local dev).
export async function setCommitStatus(
  owner: string,
  repo: string,
  sha: string,
  state: CommitStatusState,
  targetUrl: string,
  description: string,
): Promise<void> {
  const token = process.env.GITHUB_TOKEN
  if (!token) {
    console.warn("[peeka] GITHUB_TOKEN unset; skipping commit status")
    return
  }
  if (!owner || !repo || !sha) return

  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/statuses/${sha}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "peeka",
        },
        body: JSON.stringify({
          state,
          target_url: targetUrl,
          description: description.slice(0, 140),
          context: "peeka/visual",
        }),
      },
    )
    if (!res.ok) {
      console.error(
        `[peeka] GitHub status failed: ${res.status} ${await res.text()}`,
      )
    }
  } catch (err) {
    console.error("[peeka] GitHub status error", err)
  }
}
