import "server-only";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rm, stat as statFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { decryptObject, encryptObject } from "@/lib/crypto/encryption";
import { getEnv, isProduction, s3Settings } from "@/lib/env";

/**
 * Object storage behind one interface: S3 / Cloudflare R2 when credentials are
 * configured, otherwise the local filesystem (development only).
 *
 * Two buckets: "public" for storefront media, "vault" for private objects
 * (KYC documents, paid downloads). Vault objects are additionally encrypted
 * with AES-256-GCM before they leave the process, bound to their key.
 */

export type BucketKind = "public" | "vault";

export interface ObjectStorage {
  readonly driver: "s3" | "local";
  put(bucket: BucketKind, key: string, body: Uint8Array, contentType: string): Promise<void>;
  /** Object bytes, or null when the key does not exist. */
  get(bucket: BucketKind, key: string): Promise<Buffer | null>;
  remove(bucket: BucketKind, key: string): Promise<void>;
  /** Stream an object of unknown length (multipart upload on S3). */
  putStream(bucket: BucketKind, key: string, body: Readable, contentType: string): Promise<void>;
  /** Object size in bytes, or null when the key does not exist. */
  size(bucket: BucketKind, key: string): Promise<number | null>;
  /** Stream bytes [start, end] (inclusive), or the whole object. */
  getStream(bucket: BucketKind, key: string, range?: { start: number; end: number }): Promise<Readable>;
}

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,511}$/;

export function assertValidKey(key: string): void {
  if (!KEY_PATTERN.test(key) || key.includes("..") || key.includes("//")) {
    throw new Error(`Invalid storage key: ${key}`);
  }
}

function bucketName(bucket: BucketKind): string {
  const env = getEnv();
  return bucket === "public" ? env.S3_BUCKET_PUBLIC : env.S3_BUCKET_VAULT;
}

class S3Storage implements ObjectStorage {
  readonly driver = "s3" as const;

  constructor(private readonly client: S3Client) {}

  async put(bucket: BucketKind, key: string, body: Uint8Array, contentType: string): Promise<void> {
    assertValidKey(key);
    await this.client.send(
      new PutObjectCommand({ Bucket: bucketName(bucket), Key: key, Body: body, ContentType: contentType }),
    );
  }

  async get(bucket: BucketKind, key: string): Promise<Buffer | null> {
    assertValidKey(key);
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: bucketName(bucket), Key: key }));
      if (!response.Body) return null;
      return Buffer.from(await response.Body.transformToByteArray());
    } catch (error) {
      if (error instanceof Error && (error.name === "NoSuchKey" || error.name === "NotFound")) return null;
      throw error;
    }
  }

  async remove(bucket: BucketKind, key: string): Promise<void> {
    assertValidKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: bucketName(bucket), Key: key }));
  }

  async putStream(bucket: BucketKind, key: string, body: Readable, contentType: string): Promise<void> {
    assertValidKey(key);
    const upload = new Upload({
      client: this.client,
      params: { Bucket: bucketName(bucket), Key: key, Body: body, ContentType: contentType },
      queueSize: 4,
      partSize: 8 * 1024 * 1024,
    });
    await upload.done();
  }

  async size(bucket: BucketKind, key: string): Promise<number | null> {
    assertValidKey(key);
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: bucketName(bucket), Key: key }));
      return head.ContentLength ?? null;
    } catch (error) {
      if (error instanceof Error && (error.name === "NotFound" || error.name === "NoSuchKey")) return null;
      throw error;
    }
  }

  async getStream(bucket: BucketKind, key: string, range?: { start: number; end: number }): Promise<Readable> {
    assertValidKey(key);
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: bucketName(bucket),
        Key: key,
        Range: range ? `bytes=${range.start}-${range.end}` : undefined,
      }),
    );
    if (!response.Body) throw new Error(`Object ${key} has no body`);
    return Readable.fromWeb(response.Body.transformToWebStream() as WebReadableStream<Uint8Array>);
  }
}

class LocalStorage implements ObjectStorage {
  readonly driver = "local" as const;

  constructor(private readonly root: string) {}

  private filePath(bucket: BucketKind, key: string): string {
    assertValidKey(key);
    const base = path.resolve(this.root, bucket);
    const target = path.resolve(base, key);
    if (!target.startsWith(base + path.sep)) throw new Error(`Invalid storage key: ${key}`);
    return target;
  }

  async put(bucket: BucketKind, key: string, body: Uint8Array): Promise<void> {
    const target = this.filePath(bucket, key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body);
  }

  async get(bucket: BucketKind, key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.filePath(bucket, key));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
  }

  async remove(bucket: BucketKind, key: string): Promise<void> {
    await rm(this.filePath(bucket, key), { force: true });
  }

  async putStream(bucket: BucketKind, key: string, body: Readable): Promise<void> {
    const target = this.filePath(bucket, key);
    await mkdir(path.dirname(target), { recursive: true });
    await pipeline(body, createWriteStream(target));
  }

  async size(bucket: BucketKind, key: string): Promise<number | null> {
    try {
      return (await statFile(this.filePath(bucket, key))).size;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
  }

  async getStream(bucket: BucketKind, key: string, range?: { start: number; end: number }): Promise<Readable> {
    return createReadStream(this.filePath(bucket, key), range ? { start: range.start, end: range.end } : undefined);
  }
}

let storage: ObjectStorage | undefined;

export function getStorage(): ObjectStorage {
  if (storage) return storage;
  const settings = s3Settings();
  if (settings) {
    storage = new S3Storage(
      new S3Client({
        region: settings.region,
        endpoint: settings.endpoint,
        forcePathStyle: settings.endpoint !== undefined,
        credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
      }),
    );
  } else {
    if (isProduction()) {
      throw new Error("Object storage is not configured: set S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.");
    }
    storage = new LocalStorage(path.resolve(process.cwd(), getEnv().LOCAL_STORAGE_DIR));
  }
  return storage;
}

/** Encrypt and store a private object in the vault bucket. */
export async function putVaultObject(key: string, plaintext: Uint8Array, contentType: string): Promise<void> {
  await getStorage().put("vault", key, encryptObject(plaintext, key), contentType);
}

/** Read and decrypt a vault object, or null when it does not exist. */
export async function getVaultObject(key: string): Promise<Buffer | null> {
  const blob = await getStorage().get("vault", key);
  return blob ? decryptObject(blob, key) : null;
}

export async function deleteVaultObject(key: string): Promise<void> {
  await getStorage().remove("vault", key);
}
