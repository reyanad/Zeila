import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes, type DecipherGCM } from "node:crypto";
import { Transform, type TransformCallback } from "node:stream";
import { deriveKey } from "./keys";

/**
 * Streaming AES-256-GCM for large vault objects (digital products).
 *
 * Layout: 1 version byte (0x02) | 12-byte IV | ciphertext | 16-byte auth tag.
 * The tag is appended because it is only known once the whole file has been
 * encrypted. To decrypt, read the header and tag with two small ranged reads,
 * then stream the ciphertext through `createDecryptStream`.
 *
 * `context` (the storage key) is bound as additional authenticated data.
 */

export const STREAM_VERSION = 2;
export const STREAM_HEADER_BYTES = 1 + 12;
export const STREAM_TAG_BYTES = 16;

export function createEncryptStream(context: string): Transform {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey("object-encryption"), iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const header = Buffer.concat([Buffer.from([STREAM_VERSION]), iv]);
  let headerSent = false;

  return new Transform({
    transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
      try {
        const encrypted = cipher.update(chunk);
        if (!headerSent) {
          headerSent = true;
          callback(null, Buffer.concat([header, encrypted]));
          return;
        }
        callback(null, encrypted);
      } catch (error) {
        callback(error instanceof Error ? error : new Error(String(error)));
      }
    },
    flush(callback: TransformCallback) {
      try {
        const final = cipher.final();
        const prefix = headerSent ? Buffer.alloc(0) : header;
        headerSent = true;
        callback(null, Buffer.concat([prefix, final, cipher.getAuthTag()]));
      } catch (error) {
        callback(error instanceof Error ? error : new Error(String(error)));
      }
    },
  });
}

/** Parse the stream header; returns the IV or throws on an unknown format. */
export function parseStreamHeader(header: Buffer): Buffer {
  if (header.length !== STREAM_HEADER_BYTES || header[0] !== STREAM_VERSION) {
    throw new Error("Unrecognised encrypted stream format");
  }
  return header.subarray(1);
}

/** Decrypting transform for the ciphertext section (between header and tag). */
export function createDecryptStream(context: string, iv: Buffer, tag: Buffer): DecipherGCM {
  const decipher = createDecipheriv("aes-256-gcm", deriveKey("object-encryption"), iv);
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(tag);
  return decipher;
}

export class UploadTooLargeError extends Error {
  constructor(readonly limitBytes: number) {
    super(`Upload exceeds ${limitBytes} bytes`);
    this.name = "UploadTooLargeError";
  }
}

/** Pass-through that counts bytes, hashes the plaintext (SHA-256) and enforces a size limit. */
export class MeasureStream extends Transform {
  private readonly hash = createHash("sha256");
  bytes = 0;

  constructor(private readonly limitBytes: number) {
    super();
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.bytes += chunk.length;
    if (this.bytes > this.limitBytes) {
      callback(new UploadTooLargeError(this.limitBytes));
      return;
    }
    this.hash.update(chunk);
    callback(null, chunk);
  }

  digestHex(): string {
    return this.hash.digest("hex");
  }
}
