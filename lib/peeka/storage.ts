// Cloudflare R2 access via the S3-compatible API. R2 is the single source of
// truth: it holds the PNGs (uploaded snapshots, generated diffs, approved
// baselines) and one manifest.json per project+branch.

import {
  CopyObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import type { BranchManifest } from "./types"

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

export function manifestKey(project: string, branch: string): string {
  return `manifests/${slug(project)}/${slug(branch)}.json`
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

export function baselineKey(
  project: string,
  branch: string,
  snapshot: string,
  variant: string,
): string {
  return `baselines/${slug(project)}/${slug(branch)}/${imageName(slug(snapshot), variant)}`
}

// Known prefixes the image proxy is allowed to serve.
export const SERVABLE_PREFIXES = ["snapshots/", "diffs/", "baselines/"]

// --- Object operations ------------------------------------------------------

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

export async function getManifest(
  project: string,
  branch: string,
): Promise<BranchManifest | null> {
  const buf = await getObject(manifestKey(project, branch))
  if (!buf) return null
  return JSON.parse(buf.toString("utf8")) as BranchManifest
}

export async function putManifest(manifest: BranchManifest): Promise<void> {
  await putObject(
    manifestKey(manifest.project, manifest.branch),
    Buffer.from(JSON.stringify(manifest), "utf8"),
    "application/json",
  )
}

// List project slugs by reading the `manifests/<project>/` prefixes.
export async function listProjects(): Promise<string[]> {
  const res = await s3().send(
    new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: "manifests/",
      Delimiter: "/",
    }),
  )
  return (res.CommonPrefixes ?? [])
    .map((p) => p.Prefix?.replace(/^manifests\//, "").replace(/\/$/, ""))
    .filter((p): p is string => Boolean(p))
}

// List branch manifest keys for a project (e.g. to find all branches).
export async function listBranches(project: string): Promise<string[]> {
  const res = await s3().send(
    new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: `manifests/${slug(project)}/`,
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
