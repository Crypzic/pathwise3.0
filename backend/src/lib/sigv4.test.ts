// SigV4 must match AWS's published examples exactly — a signer that's almost
// right produces 403s, not test failures, so the reference vectors are the
// only trustworthy check.
import test from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_PAYLOAD_HASH,
  sha256Hex,
  signingKey,
  signRequest,
} from "./sigv4.js";

// --- AWS documentation vector: signing key derivation -----------------------
// From "Examples of how to derive a signing key" in the SigV4 docs.
test("signing key derivation matches the AWS documentation vector", () => {
  const key = signingKey(
    "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
    "20150830",
    "us-east-1",
    "iam"
  );
  assert.equal(
    key.toString("hex"),
    "c4afb1cc5771d871763a393e44b703571b55cc28424d1a5e86da6ed3c154a4b9"
  );
});

// --- AWS documentation vector: S3 GET object --------------------------------
// The worked example from "Authenticating Requests: Using the Authorization
// Header" — GET /test.txt from examplebucket with a Range header.
test("S3 GET object example produces the documented signature", () => {
  const { headers } = signRequest({
    method: "GET",
    url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
    headers: { range: "bytes=0-9" },
    payloadHash: EMPTY_PAYLOAD_HASH,
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    region: "us-east-1",
    service: "s3",
    now: new Date("2013-05-24T00:00:00Z"),
  });

  assert.match(headers.authorization, /^AWS4-HMAC-SHA256 /);
  assert.match(
    headers.authorization,
    /Credential=AKIAIOSFODNN7EXAMPLE\/20130524\/us-east-1\/s3\/aws4_request/
  );
  assert.match(
    headers.authorization,
    /SignedHeaders=host;range;x-amz-content-sha256;x-amz-date/
  );
  assert.match(
    headers.authorization,
    /Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41$/
  );
});

// --- AWS documentation vector: S3 PUT object --------------------------------
// Same doc page — PUT test$file.text with a date header and storage class.
test("S3 PUT object example produces the documented signature", () => {
  const body = "Welcome to Amazon S3.";
  const { headers } = signRequest({
    method: "PUT",
    url: new URL("https://examplebucket.s3.amazonaws.com/test$file.text"),
    headers: {
      date: "Fri, 24 May 2013 00:00:00 GMT",
      "x-amz-storage-class": "REDUCED_REDUNDANCY",
    },
    payloadHash: sha256Hex(body),
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    region: "us-east-1",
    service: "s3",
    now: new Date("2013-05-24T00:00:00Z"),
  });

  assert.match(
    headers.authorization,
    /Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd$/
  );
});

// --- Structural checks ------------------------------------------------------

test("required headers are always present and dated correctly", () => {
  const { headers } = signRequest({
    method: "GET",
    url: new URL("https://acc.r2.cloudflarestorage.com/pathwise/uploads/u1/f.pdf"),
    headers: {},
    payloadHash: EMPTY_PAYLOAD_HASH,
    accessKeyId: "AK",
    secretAccessKey: "SK",
    region: "auto",
    service: "s3",
    now: new Date("2026-07-29T12:34:56Z"),
  });
  assert.equal(headers["host"], "acc.r2.cloudflarestorage.com");
  assert.equal(headers["x-amz-date"], "20260729T123456Z");
  assert.equal(headers["x-amz-content-sha256"], EMPTY_PAYLOAD_HASH);
});

test("signature changes when the payload changes", () => {
  const base = {
    method: "PUT",
    url: new URL("https://host.example.com/bucket/key"),
    headers: {},
    accessKeyId: "AK",
    secretAccessKey: "SK",
    region: "auto",
    service: "s3",
    now: new Date("2026-07-29T00:00:00Z"),
  };
  const a = signRequest({ ...base, payloadHash: sha256Hex("one") });
  const b = signRequest({ ...base, payloadHash: sha256Hex("two") });
  assert.notEqual(a.headers.authorization, b.headers.authorization);
});

test("signature changes when the key path changes", () => {
  const base = {
    method: "GET",
    headers: {},
    payloadHash: EMPTY_PAYLOAD_HASH,
    accessKeyId: "AK",
    secretAccessKey: "SK",
    region: "auto",
    service: "s3",
    now: new Date("2026-07-29T00:00:00Z"),
  };
  const a = signRequest({ ...base, url: new URL("https://h.example/b/k1") });
  const b = signRequest({ ...base, url: new URL("https://h.example/b/k2") });
  assert.notEqual(a.headers.authorization, b.headers.authorization);
});
