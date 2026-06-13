// Pixel-level image diffing with pixelmatch + pngjs. Node-only (not Edge-safe).

import pixelmatch from "pixelmatch"
import { PNG } from "pngjs"

export interface DiffResult {
  diffPng: Buffer | null // null when sizes mismatch (no meaningful overlay)
  mismatchedPixels: number
  totalPixels: number
  percent: number // 0..100
  sizeMismatch: boolean
  width: number
  height: number
}

// Compare two PNG buffers. On a size mismatch we report a 100% difference and
// skip pixelmatch (which requires identical dimensions).
export function diffPngBuffers(baseline: Buffer, candidate: Buffer): DiffResult {
  const base = PNG.sync.read(baseline)
  const cand = PNG.sync.read(candidate)

  if (base.width !== cand.width || base.height !== cand.height) {
    const totalPixels = cand.width * cand.height
    return {
      diffPng: null,
      mismatchedPixels: totalPixels,
      totalPixels,
      percent: 100,
      sizeMismatch: true,
      width: cand.width,
      height: cand.height,
    }
  }

  const { width, height } = base
  const diff = new PNG({ width, height })
  const mismatchedPixels = pixelmatch(
    base.data,
    cand.data,
    diff.data,
    width,
    height,
    { threshold: 0.1 },
  )
  const totalPixels = width * height

  return {
    diffPng: PNG.sync.write(diff),
    mismatchedPixels,
    totalPixels,
    percent: totalPixels === 0 ? 0 : (mismatchedPixels / totalPixels) * 100,
    sizeMismatch: false,
    width,
    height,
  }
}

// Read PNG dimensions without diffing (used for first-seen snapshots).
export function readPngSize(buf: Buffer): { width: number; height: number } {
  const png = PNG.sync.read(buf)
  return { width: png.width, height: png.height }
}
