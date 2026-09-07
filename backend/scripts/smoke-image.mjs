// Image-upload end-to-end smoke (PATHWISE 2.0 Phase 5).
// Server must be running with AI_PROVIDER=mock.
// Usage: node scripts/smoke-image.mjs [baseUrl]
const BASE = process.argv[2] ?? "http://localhost:4000";

let passed = 0;
let failed = 0;
function check(name, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  ✔ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✘ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function req(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON
  }
  return { status: res.status, data };
}

async function uploadFile(path, token, filename, mime, buffer) {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mime }), filename);
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON
  }
  return { status: res.status, data };
}

// A tiny buffer with a valid PNG header — enough for signature validation,
// and the mock provider transcribes deterministically from bytes.
function fakePng(size = 4096) {
  const buf = Buffer.alloc(size, 7);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  return buf;
}

console.log(`Image upload smoke against ${BASE}`);

const email = `img-smoke-${Date.now()}@test.local`;
const su = await req("POST", "/api/auth/signup", {
  body: { name: "Image Smoke", email, password: "smoketest123" },
});
const tok = su.data?.token;
check("signup ok", Boolean(tok));
await req("POST", "/api/auth/accept-privacy", { token: tok });

const course = await req("POST", "/api/courses", {
  token: tok,
  body: { name: "Photo Notes Course" },
});
const courseId = course.data?.course?.id;
check("course created", Boolean(courseId));

// A renamed non-image must be rejected by magic bytes.
const disguised = await uploadFile(
  `/api/courses/${courseId}/uploads`,
  tok,
  "totally-a-photo.png",
  "image/png",
  Buffer.from("MZ\x90\x00 definitely an executable padded to enough length")
);
check("disguised exe as .png rejected (415)", disguised.status === 415, `got ${disguised.status}`);

// An oversized image must hit the image cap (default 8MB).
const big = await uploadFile(
  `/api/courses/${courseId}/uploads`,
  tok,
  "huge.png",
  "image/png",
  fakePng(9 * 1024 * 1024)
);
check("oversized image rejected (413)", big.status === 413, `got ${big.status}`);

// A valid PNG flows through transcription -> moderation -> topics.
const good = await uploadFile(
  `/api/courses/${courseId}/uploads`,
  tok,
  "whiteboard.png",
  "image/png",
  fakePng()
);
check("image upload processed (201)", good.status === 201, `got ${good.status}: ${JSON.stringify(good.data)}`);
check("upload status is processed", good.data?.upload?.status === "processed");
check(
  "image produced topics",
  (good.data?.topicCount ?? 0) > 0,
  `topicCount=${good.data?.topicCount}`
);

// The knowledge map must show them like any document-derived topics.
const detail = await req("GET", `/api/courses/${courseId}`, { token: tok });
check(
  "course detail lists topics from the image",
  (detail.data?.course?.topics?.length ?? 0) > 0
);

// Document uploads are exercised by the 1.0 suite and unit tests — no
// fabricated PDF here: pdfjs's behavior on a synthetic body is unbounded
// (a hand-built "PDF" once hung this script for minutes).

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
