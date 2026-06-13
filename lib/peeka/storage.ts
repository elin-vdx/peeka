// Cloudflare R2 access via the S3-compatible API. Storage is many small
// objects (one per build, per chunk, per baseline) plus a small per-branch
// index, so concurrent ingests/approvals don't clobber a single big file.

import {
  CopyObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import type {
  BaselineRecord,
  BranchIndex,
  BuildRecord,
  ChunkResult,
  ReviewSidecar,
} from "./types"

const BUCKET = process.env.R2_BUCKET ?? "peeka"

let client: S3Client | null = null

function s3(): S3Client {
  if (client) return client
  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "Missing R2 credentials: set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY",
    )
  }
  client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  })
  return client
}

// --- Key helpers -----------------------------------------------------------

// Normalize an arbitrary label into a single safe path token.
export function slug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
}

function imageName(snapshotKey: string, variant: string): string {
  return `${snapshotKey}__${slug(variant)}.png`
}

function jsonName(snapshotKey: string, variant: string): string {
  return `${snapshotKey}__${slug(variant)}.json`
}

// Key used in maps/sidecars to identify a snapshot+variant.
export function pairKey(snapshotKey: string, variant: string): string {
  return `${snapshotKey}::${slug(variant)}`
}

export function snapshotKey(
  project: string,
  commit: string,
  snapshot: string,
  variant: string,
): string {
  return `snapshots/${slug(project)}/${slug(commit)}/${imageName(slug(snapshot), variant)}`
}

export function diffKey(
  project: string,
  commit: string,
  snapshot: string,
  variant: string,
): string {
  return `diffs/${slug(project)}/${slug(commit)}/${imageName(slug(snapshot), variant)}`
}

export function baselineImageKey(
  project: string,
  branch: string,
  snapshot: string,
  variant: string,
): string {
  return `baselines/${slug(project)}/${slug(branch)}/${imageName(slug(snapshot), variant)}`
}

export function baselineMetaKey(
  project: string,
  branch: string,
  snapshot: string,
  variant: string,
): string {
  return `baselines/${slug(project)}/${slug(branch)}/${jsonName(slug(snapshot), variant)}`
}

export function buildKey(
  project: string,
  branch: string,
  buildId: string,
): string {
  return `builds/${slug(project)}/${slug(branch)}/${buildId}.json`
}

export function chunkKey(
  project: string,
  branch: string,
  buildId: string,
  chunk: number,
): string {
  return `builds/${slug(project)}/${slug(branch)}/${buildId}/chunk-${chunk}.json`
}

export function doneKey(
  project: string,
  branch: string,
  buildId: string,
  chunk: number,
): string {
  return `builds/${slug(project)}/${slug(branch)}/${buildId}/done-${chunk}`
}

export function donePrefix(
  project: string,
  branch: string,
  buildId: string,
): string {
  return `builds/${slug(project)}/${slug(branch)}/${buildId}/done-`
}

export function reviewKey(
  project: string,
  branch: string,
  buildId: string,
): string {
  return `reviews/${slug(project)}/${slug(branch)}/${buildId}.json`
}

export function indexKey(project: string, branch: string): string {
  return `index/${slug(project)}/${slug(branch)}.json`
}

// Known prefixes the image proxy is allowed to serve.
export const SERVABLE_PREFIXES = ["snapshots/", "diffs/", "baselines/"]

// --- Generic object operations ---------------------------------------------

export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  await s3().send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  )
}

export async function getObject(key: string): Promise<Buffer | null> {
  try {
    const res = await s3().send(
      new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    )
    if (!res.Body) return null
    const bytes = await res.Body.transformToByteArray()
    return Buffer.from(bytes)
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
}

export async function copyObject(src: string, dest: string): Promise<void> {
  await s3().send(
    new CopyObjectCommand({
      Bucket: BUCKET,
      CopySource: `${BUCKET}/${encodeURIComponent(src).replace(/%2F/g, "/")}`,
      Key: dest,
    }),
  )
}

async function putJson(key: string, value: unknown): Promise<void> {
  await putObject(key, Buffer.from(JSON.stringify(value), "utf8"), "application/json")
}

async function getJson<T>(key: string): Promise<T | null> {
  const buf = await getObject(key)
  if (!buf) return null
  return JSON.parse(buf.toString("utf8")) as T
}

// --- Domain object operations ----------------------------------------------

export function putBuild(build: BuildRecord): Promise<void> {
  return putJson(buildKey(build.project, build.branch, build.id), build)
}

export function getBuild(
  project: string,
  branch: string,
  buildId: string,
): Promise<BuildRecord | null> {
  return getJson<BuildRecord>(buildKey(project, branch, buildId))
}

export function putChunk(
  project: string,
  branch: string,
  buildId: string,
  result: ChunkResult,
): Promise<void> {
  return putJson(chunkKey(project, branch, buildId, result.chunk), result)
}

export function getChunk(
  project: string,
  branch: string,
  buildId: string,
  chunk: number,
): Promise<ChunkResult | null> {
  return getJson<ChunkResult>(chunkKey(project, branch, buildId, chunk))
}

export function markChunkDone(
  project: string,
  branch: string,
  buildId: string,
  chunk: number,
): Promise<void> {
  return putObject(doneKey(project, branch, buildId, chunk), Buffer.from("1"), "text/plain")
}

// How many chunks have written their done-marker so far.
export async function countDone(
  project: string,
  branch: string,
  buildId: string,
): Promise<number> {
  const res = await s3().send(
    new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: donePrefix(project, branch, buildId),
    }),
  )
  return res.KeyCount ?? res.Contents?.length ?? 0
}

export function putBaseline(
  project: string,
  branch: string,
  snapshot: string,
  variant: string,
  record: BaselineRecord,
): Promise<void> {
  return putJson(baselineMetaKey(project, branch, snapshot, variant), record)
}

export function getBaseline(
  project: string,
  branch: string,
  snapshot: string,
  variant: string,
): Promise<BaselineRecord | null> {
  return getJson<BaselineRecord>(baselineMetaKey(project, branch, snapshot, variant))
}

export function getReviewSidecar(
  project: string,
  branch: string,
  buildId: string,
): Promise<ReviewSidecar | null> {
  return getJson<ReviewSidecar>(reviewKey(project, branch, buildId))
}

export function putReviewSidecar(
  project: string,
  branch: string,
  buildId: string,
  sidecar: ReviewSidecar,
): Promise<void> {
  return putJson(reviewKey(project, branch, buildId), sidecar)
}

// --- Per-branch index (small, shared, mutable) -----------------------------

export function getIndex(
  project: string,
  branch: string,
): Promise<BranchIndex | null> {
  return getJson<BranchIndex>(indexKey(project, branch))
}

// Read-modify-write the small index with a retry loop. There is no S3 CAS on
// R2's S3 API, so we re-read and re-apply on each attempt; the mutate fn must
// be idempotent (e.g. upsert-by-id). Contention is rare since the index is
// only touched on build finalize / approval, not on every snapshot.
export async function updateIndex(
  project: string,
  branch: string,
  mutate: (index: BranchIndex) => BranchIndex,
  attempts = 4,
): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    const current =
      (await getIndex(project, branch)) ??
      ({
        version: 2,
        project: slug(project),
        branch: slug(branch),
        updatedAt: new Date().toISOString(),
        builds: [],
      } satisfies BranchIndex)
    const next = mutate(current)
    next.updatedAt = new Date().toISOString()
    try {
      await putJson(indexKey(project, branch), next)
      return
    } catch (err) {
      if (i === attempts - 1) throw err
    }
  }
}

// --- Listing ----------------------------------------------------------------

// List project slugs by reading the `index/<project>/` prefixes.
export async function listProjects(): Promise<string[]> {
  const res = await s3().send(
    new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: "index/",
      Delimiter: "/",
    }),
  )
  return (res.CommonPrefixes ?? [])
    .map((p) => p.Prefix?.replace(/^index\//, "").replace(/\/$/, ""))
    .filter((p): p is string => Boolean(p))
}

// List branch slugs that have an index for a project.
export async function listBranches(project: string): Promise<string[]> {
  const res = await s3().send(
    new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: `index/${slug(project)}/`,
    }),
  )
  return (res.Contents ?? [])
    .map((o) => o.Key?.split("/").pop()?.replace(/\.json$/, ""))
    .filter((b): b is string => Boolean(b))
}

function isNotFound(err: unknown): boolean {
  const name = (err as { name?: string })?.name
  const code = (err as { Code?: string })?.Code
  const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata
    ?.httpStatusCode
  return (
    name === "NoSuchKey" ||
    name === "NotFound" ||
    code === "NoSuchKey" ||
    status === 404
  )
}
