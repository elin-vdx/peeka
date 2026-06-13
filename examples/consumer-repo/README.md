# Wiring a repo into Peeka

These files go in a **component repo** (the one with Storybook), not in Peeka.
They capture Storybook screenshots with the Playwright test-runner and upload
them to Peeka, which diffs them and reports a commit status on your PRs.

```
.github/workflows/peeka.yml        ← CI: capture + upload, on PR and push to main
.storybook/test-runner.ts          ← screenshots each story per viewport
scripts/peeka-upload.mjs           ← POSTs the PNGs to Peeka /api/ingest
```

## How it connects

```
PR / push to main
   └─ GitHub Action (peeka.yml)
        ├─ build-storybook         → storybook-static/
        ├─ test-storybook          → peeka-snapshots/*.png   (postVisit hook)
        └─ peeka-upload.mjs        → POST  PEEKA_URL/api/ingest
                                          │
Peeka stores + diffs (async) ─────────────┘
   └─ commit status on the PR head SHA  ✓/✗ → links to the Peeka review page
```

- **On a PR:** snapshots are diffed against the branch's baselines; changed/new
  ones need approval in the Peeka UI. The PR check is red until approved.
- **On push to `main`:** Peeka auto-promotes the snapshots to baseline (because
  the branch equals the repo's default branch), so PR branches always have
  something to diff against.

## One-time setup

1. **Dev deps** in the component repo:
   ```
   npm i -D @storybook/test-runner http-server wait-on concurrently
   ```
2. **Storybook build script** — ensure `build-storybook` outputs `storybook-static`
   (default for Storybook 7/8).
3. **Repo settings → Secrets and variables → Actions:**
   - Secret `PEEKA_URL` — your Peeka deployment, e.g. `https://peeka.your.co`
   - Secret `PEEKA_INGEST_TOKEN` — the same value as Peeka's `PEEKA_INGEST_TOKEN`
   - Variable `PEEKA_PROJECT` — a stable id for this repo, e.g. `web-app`
4. Copy the three files into the repo, commit, open a PR. The first `main` build
   seeds baselines; subsequent PRs diff against them.

## Naming / variants

PNGs are named `<Story Title> <Story Name>__<variant>.png`. The `__<variant>`
suffix splits the human snapshot name from its capture target. Edit `VIEWPORTS`
in `.storybook/test-runner.ts` to change which targets are captured — each key
becomes an independent baseline (e.g. `chrome-large` and `chrome-small` are two
separate snapshots of the same story).

## Notes

- The test-runner uses Chromium only here; add browsers/viewports as variants
  if you want cross-browser coverage.
- Large story sets (200–500 snapshots) are fine — Peeka ingests immediately and
  diffs asynchronously via its queue; the Action returns as soon as the upload
  completes.
