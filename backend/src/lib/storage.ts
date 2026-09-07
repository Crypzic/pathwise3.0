// File storage for uploaded materials (Step 1 item 5, made durable for beta).
//
// Two providers behind one interface, same pattern as AI/email/billing:
//
//   local — writes under backend/uploads. Fine for dev; EPHEMERAL on Render,
//           where the disk is wiped on every redeploy. Extracted text and
//           topics live in the database and survive, but the original file
//           would be gone.
//   s3    — any S3-compatible store via SigV4 (lib/sigv4.ts): Cloudflare R2
//           (free tier, no egress fees), AWS S3, Backblaze B2. This is the
//           beta/production setting.
//
// storagePath in the Upload row is a provider-relative key
// ("<userId>/<uuid>-<name>"). Rows written before this refactor hold absolute
// local paths — the local provider still resolves those.
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { env } from "./env.js";
import { EMPTY_PAYLOAD_HASH, sha256Hex, signRequest } from "./sigv4.js";

const here = dirname(fileURLToPath(import.meta.url));
// backend/uploads (gitignored)
const UPLOAD_ROOT = join(here, "..", "..", "uploads");

export interface SavedFile {
  storagePath: string;
  sizeBytes: number;
}

export interface StorageProvider {
  readonly name: string;
  save(userId: string, originalName: string, data: Buffer): Promise<SavedFile>;
  read(storagePath: string): Promise<Buffer>;
  /** Best-effort delete — callers treat failure as non-fatal. */
  remove(storagePath: string): Promise<void>;
}

function keyFor(userId: string, originalName: string): string {
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${userId}/${randomUUID()}-${safeName}`;
}

// --- Local disk ------------------------------------------------------------

class LocalStorageProvider implements StorageProvider {
  readonly name = "local";

  async save(userId: string, originalName: string, data: Buffer): Promise<SavedFile> {
    const key = keyFor(userId, originalName);
    const fullPath = join(UPLOAD_ROOT, key);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, data);
    return { storagePath: key, sizeBytes: data.length };
  }

  async read(storagePath: string): Promise<Buffer> {
    // Pre-refactor rows stored absolute paths; new rows store keys.
    const fullPath = isAbsolute(storagePath)
      ? storagePath
      : join(UPLOAD_ROOT, storagePath);
    return readFile(fullPath);
  }

  async remove(storagePath: string): Promise<void> {
    const fullPath = isAbsolute(storagePath)
      ? storagePath
      : join(UPLOAD_ROOT, storagePath);
    await unlink(fullPath).catch(() => {
      // Already gone is fine.
    });
  }
}

// --- S3-compatible (R2 / S3 / B2) ------------------------------------------

class S3StorageProvider implements StorageProvider {
  readonly name = "s3";

  private urlFor(key: string): URL {
    // Path-style addressing: <endpoint>/<bucket>/<key>. R2 and B2 both use
    // this; S3 still supports it.
    const base = env.S3_ENDPOINT.replace(/\/+$/, "");
    return new URL(`${base}/${env.S3_BUCKET}/${key}`);
  }

  private async request(
    method: "PUT" | "GET" | "DELETE",
    key: string,
    body?: Buffer
  ): Promise<Response> {
    const url = this.urlFor(key);
    const payloadHash = body ? sha256Hex(body) : EMPTY_PAYLOAD_HASH;
    const extra: Record<string, string> = {};
    if (body) extra["content-type"] = "application/octet-stream";

    const { headers } = signRequest({
      method,
      url,
      headers: extra,
      payloadHash,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      region: env.S3_REGION,
      service: "s3",
      now: new Date(),
    });

    return fetch(url, {
      method,
      headers,
      // Uint8Array view keeps fetch's BodyInit type happy across Node versions.
      body: body ? new Uint8Array(body) : undefined,
    });
  }

  async save(userId: string, originalName: string, data: Buffer): Promise<SavedFile> {
    const key = keyFor(userId, originalName);
    const res = await this.request("PUT", key, data);
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Storage upload failed (${res.status}): ${detail.slice(0, 300)}`);
    }
    return { storagePath: key, sizeBytes: data.length };
  }

  async read(storagePath: string): Promise<Buffer> {
    const res = await this.request("GET", storagePath);
    if (!res.ok) {
      throw new Error(`Storage read failed (${res.status}) for ${storagePath}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  async remove(storagePath: string): Promise<void> {
    const res = await this.request("DELETE", storagePath);
    // 404 = already gone; anything else is logged by the caller if it cares.
    if (!res.ok && res.status !== 404) {
      throw new Error(`Storage delete failed (${res.status}) for ${storagePath}`);
    }
  }
}

function createProvider(): StorageProvider {
  if (env.STORAGE_PROVIDER === "s3") return new S3StorageProvider();
  return new LocalStorageProvider();
}

export const storage: StorageProvider = createProvider();

/** @deprecated kept for older call sites; prefer storage.save(). */
export async function saveUpload(
  userId: string,
  originalName: string,
  data: Buffer
): Promise<SavedFile> {
  return storage.save(userId, originalName, data);
}
