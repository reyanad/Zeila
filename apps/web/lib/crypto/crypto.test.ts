import { randomBytes } from "node:crypto";
import { PassThrough, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { describe, expect, it } from "vitest";
import { decryptField, decryptObject, encryptField, encryptObject } from "./encryption";
import { createDecryptStream, createEncryptStream, MeasureStream, parseStreamHeader, STREAM_HEADER_BYTES, STREAM_TAG_BYTES, UploadTooLargeError } from "./stream";
import { signTicket, verifyTicket } from "./tokens";

async function collect(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

async function encrypt(plain: Buffer, context: string): Promise<Buffer> {
  const sink = new PassThrough();
  const done = collect(sink);
  await pipeline(Readable.from([plain]), createEncryptStream(context), sink);
  return done;
}

function decrypt(blob: Buffer, context: string): Promise<Buffer> {
  const iv = parseStreamHeader(blob.subarray(0, STREAM_HEADER_BYTES));
  const tag = blob.subarray(blob.length - STREAM_TAG_BYTES);
  const body = blob.subarray(STREAM_HEADER_BYTES, blob.length - STREAM_TAG_BYTES);
  return collect(Readable.from([body]).pipe(createDecryptStream(context, iv, tag)));
}

describe("field encryption", () => {
  it("round-trips and never stores plaintext", () => {
    const stored = encryptField("ET-1234567");
    expect(stored).not.toContain("1234567");
    expect(decryptField(stored)).toBe("ET-1234567");
    expect(encryptField("same")).not.toBe(encryptField("same"));
  });
});

describe("object encryption", () => {
  it("binds ciphertext to its storage key", () => {
    const blob = encryptObject(Buffer.from("passport scan"), "kyc/u1/a.png");
    expect(decryptObject(blob, "kyc/u1/a.png").toString()).toBe("passport scan");
    expect(() => decryptObject(blob, "kyc/u2/a.png")).toThrow();
  });
});

describe("streaming vault encryption", () => {
  it("round-trips a large file and rejects tampering", async () => {
    const plain = randomBytes(2 * 1024 * 1024 + 123);
    const blob = await encrypt(plain, "digital/s1/file.bin");
    expect(blob.length).toBe(plain.length + STREAM_HEADER_BYTES + STREAM_TAG_BYTES);
    expect((await decrypt(blob, "digital/s1/file.bin")).equals(plain)).toBe(true);
    const tampered = Buffer.from(blob);
    tampered[STREAM_HEADER_BYTES + 10] = (tampered[STREAM_HEADER_BYTES + 10] ?? 0) ^ 0xff;
    await expect(decrypt(tampered, "digital/s1/file.bin")).rejects.toThrow();
    await expect(decrypt(blob, "digital/s1/other.bin")).rejects.toThrow();
  });

  it("stops uploads over the size limit", async () => {
    const measure = new MeasureStream(1_000);
    await expect(pipeline(Readable.from([randomBytes(1_500)]), measure, new PassThrough())).rejects.toBeInstanceOf(UploadTooLargeError);
  });
});

describe("signed tickets", () => {
  it("verify for their own purpose only and expire", () => {
    const ticket = signTicket("download-ticket", { grantId: "g1" }, 60);
    expect(verifyTicket<{ grantId: string }>("download-ticket", ticket)).toEqual({ grantId: "g1" });
    expect(verifyTicket("upload-ticket", ticket)).toBeNull();
    expect(verifyTicket("download-ticket", `${ticket}x`)).toBeNull();
    expect(verifyTicket("download-ticket", signTicket("download-ticket", { grantId: "g1" }, -1))).toBeNull();
  });
});

describe("payout field encryption shared with the worker", () => {
  it("opens what the core package sealed, and the reverse", async () => {
    const { encryptAtRest, decryptAtRest } = await import("@marketplace/core");
    const { decryptField, encryptField } = await import("./encryption");
    expect(decryptField(encryptAtRest("0911234567"))).toBe("0911234567");
    expect(decryptAtRest(encryptField("1000123456789"))).toBe("1000123456789");
  });
});
