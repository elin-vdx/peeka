// Storybook test-runner config for Peeka visual snapshots.
//
// Runs in your COMPONENT repo (not in Peeka). After each story renders, it
// screenshots the story body at each configured viewport and writes a PNG named
//   "<Story Title>__<viewport>.png"
// into ./peeka-snapshots, which the GitHub Action then uploads to Peeka.
//
// The "__<variant>" suffix is the contract Peeka uses to split the human
// snapshot name from its capture variant.

import type { TestRunnerConfig } from "@storybook/test-runner"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

const OUT_DIR = path.resolve(process.cwd(), "peeka-snapshots")

// One entry per target you want to capture. The key becomes the variant.
const VIEWPORTS: Record<string, { width: number; height: number }> = {
  "chrome-large": { width: 1280, height: 800 },
  "chrome-small": { width: 375, height: 667 },
}

// Filesystem-safe but readable: keep the story's "Title/Subtitle" as the name,
// only stripping characters that break filenames.
function safeName(title: string, story: string): string {
  return `${title} ${story}`.replace(/[\\/:*?"<>|]/g, "-").trim()
}

const config: TestRunnerConfig = {
  async postVisit(page, context) {
    await mkdir(OUT_DIR, { recursive: true })

    // The rendered story lives in #storybook-root inside the preview iframe.
    for (const [variant, viewport] of Object.entries(VIEWPORTS)) {
      await page.setViewportSize(viewport)

      // Let layout settle after the viewport change.
      await page.waitForTimeout(100)

      const root = page.locator("#storybook-root")
      const filename = `${safeName(context.title, context.name)}__${variant}.png`

      const buffer = await root.screenshot({
        // Capture just the component, not the full viewport chrome.
        animations: "disabled",
      })
      await writeFile(path.join(OUT_DIR, filename), buffer)
    }
  },
}

export default config
