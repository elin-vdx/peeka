// Uploads the PNGs in ./peeka-snapshots to Peeka's /api/ingest.
//
// Runs in your COMPONENT repo's GitHub Action after the Storybook test-runner
// has produced screenshots. Reads config from env (set by the workflow).
//
// Required env:
//   PEEKA_URL            base URL of the Peeka app (e.g. https://peeka.your.co)
//   PEEKA_INGEST_TOKEN   shared ingest secret
//   PEEKA_PROJECT        project id (e.g. "web-app")
//   GIT_BRANCH           head branch
//   GIT_COMMIT           head commit sha
// Optional env:
//   GIT_OWNER, GIT_REPO, PR_NUMBER, DEFAULT_BRANCH (defaults to "main")

import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

const DIR = path.resolve(process.cwd(), "peeka-snapshots")

function reqEnv(name) {
  const v = process.env[name]
  if (!v) {
    console.error(`Missing required env ${name}`)
    process.exit(1)
  }
  return v
}

const PEEKA_URL = reqEnv("PEEKA_URL").replace(/\/$/, "")
const TOKEN = reqEnv("PEEKA_INGEST_TOKEN")
const project = reqEnv("PEEKA_PROJECT")
const branch = reqEnv("GIT_BRANCH")
const commit = reqEnv("GIT_COMMIT")

const files = (await readdir(DIR)).filter((f) => f.endsWith(".png"))
if (files.length === 0) {
  console.error(`No PNGs found in ${DIR}`)
  process.exit(1)
}

// Build the form. We also send an explicit `meta` map so the human name +
// variant survive even if a filename gets mangled in transit.
const form = new FormData()
form.set("project", project)
form.set("branch", branch)
form.set("commit", commit)
form.set("sha", process.env.GIT_COMMIT ?? commit)
form.set("defaultBranch", process.env.DEFAULT_BRANCH ?? "main")
if (process.env.GIT_OWNER) form.set("owner", process.env.GIT_OWNER)
if (process.env.GIT_REPO) form.set("repo", process.env.GIT_REPO)
if (process.env.PR_NUMBER) form.set("prNumber", process.env.PR_NUMBER)

const meta = {}
for (const file of files) {
  const base = file.replace(/\.png$/i, "")
  const idx = base.lastIndexOf("__")
  const name = idx === -1 ? base : base.slice(0, idx)
  const variant = idx === -1 ? "default" : base.slice(idx + 2)
  meta[file] = { name, variant }

  const buf = await readFile(path.join(DIR, file))
  form.append(
    "snapshots",
    new Blob([buf], { type: "image/png" }),
    file,
  )
}
form.set("meta", JSON.stringify(meta))

console.log(`Uploading ${files.length} snapshots to ${PEEKA_URL}/api/ingest …`)
const res = await fetch(`${PEEKA_URL}/api/ingest`, {
  method: "POST",
  headers: { "x-peeka-token": TOKEN },
  body: form,
})

const text = await res.text()
if (!res.ok) {
  console.error(`Ingest failed: ${res.status} ${text}`)
  process.exit(1)
}
console.log("Ingest ok:", text)
