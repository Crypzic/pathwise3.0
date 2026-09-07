// Hardening smoke: built-in error tracking + storage sweep on purge.
// Server must be running with CRON_SECRET set and local storage;
// DATABASE_URL must point at the server's DB (the guest is expired
// directly, same trick as smoke-guest.mjs).
// Usage: DATABASE_URL=file:./dev.db CRON_SECRET=... node scripts/smoke-hardening.mjs [baseUrl]
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const BASE = process.argv[2] ?? "http://localhost:4000";
const CRON_SECRET = process.env.CRON_SECRET ?? "";

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

async function req(method, path, { token, body, headers } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(headers ?? {}),
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

console.log(`Hardening smoke against ${BASE}`);

// --- Error tracking: client reports land, dedupe, and read back via ops.
// The marker must be LETTERS: the fingerprint normalizer strips numbers/ids
// (so real errors group across users), which would fold a numeric stamp
// into the previous run's bucket.
const marker = [...Array(10)]
  .map(() => String.fromCharCode(97 + Math.floor(Math.random() * 26)))
  .join("");
const msg = `Smoke test client crash ${marker}`;
const r1 = await req("POST", "/api/client-errors", {
  body: { message: msg, stack: `Error: boom\n    at Widget (src/pages/X.tsx:10:5)`, url: "/quiz/abc" },
});
check("client error accepted (202)", r1.status === 202, `got ${r1.status}`);
const r2 = await req("POST", "/api/client-errors", {
  body: { message: msg, stack: `Error: boom\n    at Widget (src/pages/X.tsx:99:1)`, url: "/quiz/def" },
});
check("second report accepted", r2.status === 202);

const empty = await req("POST", "/api/client-errors", { body: {} });
check("empty report rejected (400)", empty.status === 400);

const opsErrors = await req("GET", "/api/ops/errors", {
  headers: { "x-cron-secret": CRON_SECRET },
});
const row = (opsErrors.data?.errors ?? []).find((e) => e.message.includes(marker));
check("ops sees the error", Boolean(row), JSON.stringify(opsErrors.data).slice(0, 150));
check("same failure deduped into one bucket with count 2", row?.count === 2, `count ${row?.count}`);
check("source recorded as client", row?.source === "client");

const noAuth = await req("GET", "/api/ops/errors", {});
check("ops errors requires the secret (401)", noAuth.status === 401);

// --- Storage sweep: an expired guest's uploaded FILE disappears with them.
const guest = await req("POST", "/api/auth/guest", {});
const tokG = guest.data?.token;
const meG = await req("GET", "/api/auth/me", { token: tokG });
const guestId = meG.data?.user?.id;
check("guest created", Boolean(tokG) && Boolean(guestId));
await req("POST", "/api/auth/accept-privacy", { token: tokG });

const course = await req("POST", "/api/courses", { token: tokG, body: { name: "Sweep Test" } });
const courseId = course.data?.course?.id;
const png = Buffer.alloc(4096, 7);
Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
const form = new FormData();
form.append("file", new Blob([png], { type: "image/png" }), "sweep.png");
const up = await fetch(`${BASE}/api/courses/${courseId}/uploads`, {
  method: "POST",
  headers: { authorization: `Bearer ${tokG}` },
  body: form,
});
check("guest uploads a file (201)", up.status === 201, `got ${up.status}`);

// Local storage keys are <userId>/<uuid>-<name> under backend/uploads.
const guestDir = join(process.cwd(), "uploads", guestId);
const filesBefore = existsSync(guestDir) ? readdirSync(guestDir).length : 0;
check("file exists on disk before purge", filesBefore > 0, `dir ${guestDir}`);

// Expire the guest directly (same trick as smoke-guest.mjs), then sweep.
const prisma = new PrismaClient();
await prisma.user.update({
  where: { id: guestId },
  data: { guestExpiresAt: new Date(Date.now() - 60_000) },
});
const sweep = await req("POST", "/api/cron/sweep", {
  headers: { "x-cron-secret": CRON_SECRET },
});
check("cron sweep runs (200)", sweep.status === 200, `got ${sweep.status}`);
check("sweep reports the purged guest", (sweep.data?.purgedGuests ?? 0) >= 1);

const filesAfter = existsSync(guestDir) ? readdirSync(guestDir).length : 0;
check("stored files swept with the account", filesAfter === 0, `still ${filesAfter} file(s)`);
await prisma.$disconnect();

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
