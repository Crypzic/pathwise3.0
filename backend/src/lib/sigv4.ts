// AWS Signature Version 4 request signing (for the S3-compatible storage
// provider — Cloudflare R2, AWS S3, Backblaze B2).
//
// Implemented directly rather than pulling in @aws-sdk/client-s3: the app
// needs exactly three operations (PUT/GET/DELETE object) and the SDK is a
// large dependency tree for that. Same trade the billing provider makes with
// Stripe's REST API.
//
// Pure module — no env, no fetch — so the signature math is tested against
// AWS's published vectors (see sigv4.test.ts). Getting this silently wrong
// doesn't fail loudly; it fails as 403s in production.
import { createHash, createHmac } from "node:crypto";

export interface SignRequestInput {
  method: string;
  /** Full request URL, query string included. */
  url: URL;
  /** Headers to send. `host` is added automatically. Keys case-insensitive. */
  headers: Record<string, string>;
  /** Hex SHA-256 of the request body ("" body → EMPTY_PAYLOAD_HASH). */
  payloadHash: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
  /** Injected so signing is deterministic and testable. */
  now: Date;
}

export interface SignedHeaders {
  /** All headers to send, including host, x-amz-date, x-amz-content-sha256, Authorization. */
  headers: Record<string, string>;
}

/** SHA-256 of an empty body — used by GET/DELETE. */
export const EMPTY_PAYLOAD_HASH =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/** "20130524T000000Z" */
function amzDate(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * RFC 3986 strict encoding. encodeURIComponent leaves !'()* alone; AWS
 * requires them percent-encoded.
 */
function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

/** Each path segment encoded, slashes preserved. */
function canonicalUri(pathname: string): string {
  if (pathname === "") return "/";
  return pathname
    .split("/")
    .map((seg) => rfc3986(decodeURIComponent(seg)))
    .join("/");
}

/** Query params sorted by name (then value), strictly encoded. */
function canonicalQuery(url: URL): string {
  const pairs: [string, string][] = [];
  url.searchParams.forEach((value, key) => pairs.push([key, value]));
  pairs.sort(([ak, av], [bk, bv]) => (ak === bk ? av.localeCompare(bv) : ak.localeCompare(bk)));
  return pairs.map(([k, v]) => `${rfc3986(k)}=${rfc3986(v)}`).join("&");
}

/**
 * Derive the signing key: HMAC chain over date, region, service.
 * Exposed for the AWS documentation test vector.
 */
export function signingKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string
): Buffer {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

/** Sign a request. Returns every header the caller must send. */
export function signRequest(input: SignRequestInput): SignedHeaders {
  const date = amzDate(input.now); // 20130524T000000Z
  const dateStamp = date.slice(0, 8); // 20130524

  // Normalise header keys to lowercase, collapse whitespace in values.
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.headers)) {
    headers[k.toLowerCase()] = v.trim().replace(/\s+/g, " ");
  }
  headers["host"] = input.url.host;
  headers["x-amz-date"] = date;
  headers["x-amz-content-sha256"] = input.payloadHash;

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames
    .map((k) => `${k}:${headers[k]}\n`)
    .join("");
  const signedHeaders = signedHeaderNames.join(";");

  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalUri(input.url.pathname),
    canonicalQuery(input.url),
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    date,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const key = signingKey(
    input.secretAccessKey,
    dateStamp,
    input.region,
    input.service
  );
  const signature = createHmac("sha256", key)
    .update(stringToSign, "utf8")
    .digest("hex");

  return {
    headers: {
      ...headers,
      authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}
