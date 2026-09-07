// Guest-mode end-to-end smoke (PATHWISE 2.0 Phase 1).
//
// Runs against a live server (default http://localhost:4000) and checks the
// guest lifecycle the way a tester would hit it: start a guest session, accept
// privacy, feel the caps, claim the account, watch the caps lift — then
// fabricate an expired guest directly in the DB and confirm the cron sweep
// deletes it.
//
// Usage (server must be running, CRON_SECRET must match the server's):
//   DATABASE_URL=file:./dev.db CRON_SECRET=<same-as-server> \
//     node scripts/smoke-guest.mjs [baseUrl]
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

async function req(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(CRON_SECRET ? { "x-cron-secret": CRON_SECRET } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON reply
  }
  return { status: res.status, data };
}

console.log(`Guest smoke against ${BASE}`);

// --- Guest session ---------------------------------------------------------
const guest = await req("POST", "/api/auth/guest", { body: { timezone: "UTC" } });
check("guest session created (201)", guest.status === 201, `got ${guest.status}`);
check("guest is flagged", guest.data?.user?.isGuest === true);
check(
  "guest countdown present",
  typeof guest.data?.user?.guestDaysLeft === "number" &&
    guest.data.user.guestDaysLeft >= 1
);
const gtok = guest.data?.token;

const privacy = await req("POST", "/api/auth/accept-privacy", { token: gtok });
check("guest accepts privacy (200)", privacy.status === 200, `got ${privacy.status}`);

// --- Caps ------------------------------------------------------------------
const c1 = await req("POST", "/api/courses", {
  token: gtok,
  body: { name: "Guest Course" },
});
check("guest creates first course (201)", c1.status === 201, `got ${c1.status}`);

const c2 = await req("POST", "/api/courses", {
  token: gtok,
  body: { name: "Second Course" },
});
check("guest course cap enforced (402)", c2.status === 402, `got ${c2.status}`);

const checkout = await req("POST", "/api/billing/checkout", {
  token: gtok,
  body: { interval: "monthly" },
});
check("guest checkout refused (403)", checkout.status === 403, `got ${checkout.status}`);

const emailEdit = await req("PATCH", "/api/profile", {
  token: gtok,
  body: { email: "sneaky@real.example" },
});
check("guest email edit refused (403)", emailEdit.status === 403, `got ${emailEdit.status}`);

// --- Claim -----------------------------------------------------------------
const claimEmail = `claimed-${Date.now()}@test.local`;
const claim = await req("POST", "/api/auth/claim", {
  token: gtok,
  body: { name: "Claimed User", email: claimEmail, password: "longenough123" },
});
check("guest claims account (200)", claim.status === 200, `got ${claim.status}`);
check("claimed user is no longer guest", claim.data?.user?.isGuest === false);
check("claimed user keeps email", claim.data?.user?.email === claimEmail);
const ctok = claim.data?.token;

const reclaim = await req("POST", "/api/auth/claim", {
  token: ctok,
  body: { name: "X", email: `x-${Date.now()}@test.local`, password: "longenough123" },
});
check("second claim refused (409)", reclaim.status === 409, `got ${reclaim.status}`);

const c3 = await req("POST", "/api/courses", {
  token: ctok,
  body: { name: "Post-claim Course" },
});
check("course cap lifted after claim (201)", c3.status === 201, `got ${c3.status}`);

const signin = await req("POST", "/api/auth/signin", {
  body: { email: claimEmail, password: "longenough123" },
});
check("claimed account can sign in (200)", signin.status === 200, `got ${signin.status}`);

// --- Expiry purge ----------------------------------------------------------
if (!CRON_SECRET) {
  console.log("  (skipping purge check — CRON_SECRET not set)");
} else {
  const doomed = await req("POST", "/api/auth/guest", { body: {} });
  const doomedId = doomed.data?.user?.id;
  check("second guest created for purge test", Boolean(doomedId));

  const prisma = new PrismaClient();
  await prisma.user.update({
    where: { id: doomedId },
    data: { guestExpiresAt: new Date(Date.now() - 60_000) },
  });

  const sweep = await req("POST", "/api/cron/sweep", {});
  check("cron sweep runs (200)", sweep.status === 200, `got ${sweep.status}`);
  check(
    "expired guest purged",
    (sweep.data?.purgedGuests ?? 0) >= 1,
    `purgedGuests=${sweep.data?.purgedGuests}`
  );

  const gone = await prisma.user.findUnique({ where: { id: doomedId } });
  check("purged guest row is gone", gone === null);

  // Tidy up what this run created, so re-runs stay clean.
  await prisma.user.deleteMany({ where: { email: claimEmail } });
  await prisma.$disconnect();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
