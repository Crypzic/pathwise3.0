// Study Buddy Matching end-to-end smoke (PATHWISE 2.0 Phase 10).
// Server must be running with AI_PROVIDER=mock.
// Usage: node scripts/smoke-buddies.mjs [baseUrl]
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

async function makeUser(name, email) {
  const su = await req("POST", "/api/auth/signup", {
    body: { name, email, password: "smoketest123" },
  });
  const token = su.data?.token;
  await req("POST", "/api/auth/accept-privacy", { token });
  return token;
}

console.log(`Study-buddy smoke against ${BASE}`);

const stamp = Date.now();
const tokA = await makeUser("Buddy A", `bud-a-${stamp}@test.local`);
const tokB = await makeUser("Buddy B", `bud-b-${stamp}@test.local`);
const tokC = await makeUser("Buddy C", `bud-c-${stamp}@test.local`);
check("three accounts created", Boolean(tokA) && Boolean(tokB) && Boolean(tokC));

// A and B share subjects+topics via their learner profiles; C is unrelated.
// Topic/subject strings are stamped per run: matching is name-based, so
// identical "Buddy B" twins left in dev.db by earlier runs would otherwise
// tie with (and crowd out) this run's B in the top-10.
const bioProfile = {
  field: "Biology",
  academicLevel: "undergraduate",
  subjects: [`Cell Biology ${stamp}`, `Genetics ${stamp}`],
  topics: [`Mitosis ${stamp}`, `DNA Replication ${stamp}`],
  studyStyle: "buddy",
  buddyPrefs: { similarLevel: true, availability: "evenings" },
};
await req("PUT", "/api/onboarding", { token: tokA, body: { ...bioProfile, complete: true } });
await req("PUT", "/api/onboarding", { token: tokB, body: { ...bioProfile, complete: true } });
await req("PUT", "/api/onboarding", {
  token: tokC,
  body: {
    field: "History",
    academicLevel: "graduate",
    subjects: ["Medieval History"],
    topics: ["Feudalism"],
    studyStyle: "solo",
    complete: true,
  },
});

// Nobody is discoverable yet: matches endpoint says so.
const hidden = await req("GET", "/api/buddies/matches", { token: tokA });
check("not discoverable by default", hidden.status === 200 && hidden.data?.discoverable === false);
check("hidden users get no matches", (hidden.data?.matches ?? []).length === 0);

// Requests are blocked while hidden.
const meB = await req("GET", "/api/auth/me", { token: tokB });
const idB = meB.data?.user?.id;
const meC = await req("GET", "/api/auth/me", { token: tokC });
const idC = meC.data?.user?.id;
check("got user ids", Boolean(idB) && Boolean(idC));

const blockedReq = await req("POST", "/api/buddies/requests", {
  token: tokA,
  body: { toId: idB },
});
check("requests blocked while hidden (403)", blockedReq.status === 403, `got ${blockedReq.status}`);

// Opt in A and B (C stays hidden).
const onA = await req("POST", "/api/buddies/discoverable", { token: tokA, body: { on: true } });
const onB = await req("POST", "/api/buddies/discoverable", { token: tokB, body: { on: true } });
check("A and B opt in", onA.status === 200 && onB.status === 200);

// A's matches: B present with overlap reasons; C absent (hidden AND unrelated).
const matches = await req("GET", "/api/buddies/matches", { token: tokA });
const rows = matches.data?.matches ?? [];
const rowB = rows.find((m) => m.userId === idB);
check("B appears as a match", Boolean(rowB), JSON.stringify(rows).slice(0, 200));
check("C does not appear", !rows.some((m) => m.userId === idC));
check("match score is meaningful (>50)", (rowB?.score ?? 0) > 50, `score ${rowB?.score}`);
check(
  "reasons name the shared studying",
  (rowB?.reasons ?? []).length > 0 && rowB.reasons.some((r) => /both|same|shared/i.test(r)),
  JSON.stringify(rowB?.reasons)
);
check(
  "shared topics are derived names only",
  (rowB?.sharedTopics ?? []).some((t) => /mitosis|dna/i.test(t))
);

// Request handshake.
const sent = await req("POST", "/api/buddies/requests", {
  token: tokA,
  body: { toId: idB, message: "Cell bio exam in two weeks — want to trade quizzes?" },
});
check("A sends a request (201)", sent.status === 201);

const dup = await req("POST", "/api/buddies/requests", { token: tokA, body: { toId: idB } });
check("duplicate request blocked (409)", dup.status === 409, `got ${dup.status}`);

const toHidden = await req("POST", "/api/buddies/requests", { token: tokA, body: { toId: idC } });
check("requesting a hidden user fails (404)", toHidden.status === 404, `got ${toHidden.status}`);

const inbox = await req("GET", "/api/buddies/requests", { token: tokB });
const incoming = inbox.data?.incoming ?? [];
check("B sees the incoming request with message", incoming.length === 1 && /trade quizzes/.test(incoming[0].message ?? ""));

// B got an in-app notification.
const notifs = await req("GET", "/api/notifications", { token: tokB });
check(
  "buddy request notification delivered",
  (notifs.data?.notifications ?? []).some((n) => n.kind === "buddy")
);

const accept = await req("POST", `/api/buddies/requests/${incoming[0].id}/respond`, {
  token: tokB,
  body: { action: "accept" },
});
check("B accepts", accept.status === 200 && accept.data?.status === "accepted");

const buddiesA = await req("GET", "/api/buddies", { token: tokA });
const buddiesB = await req("GET", "/api/buddies", { token: tokB });
check(
  "both sides see the pair",
  (buddiesA.data?.buddies ?? []).some((b) => b.userId === idB) &&
    (buddiesB.data?.buddies ?? []).length === 1
);

const reReq = await req("POST", "/api/buddies/requests", { token: tokB, body: { toId: (await req("GET", "/api/auth/me", { token: tokA })).data?.user?.id } });
check("already-buddies blocks a new request (409)", reReq.status === 409, `got ${reReq.status}`);

// Only the recipient can respond.
const stranger = await req("POST", `/api/buddies/requests/${incoming[0].id}/respond`, {
  token: tokC,
  body: { action: "accept" },
});
check("non-recipient cannot respond (404)", stranger.status === 404);

// --- Buddy pair opens the DM lane automatically (UX review item 4) ---
const idA = (await req("GET", "/api/auth/me", { token: tokA })).data?.user?.id;
const dmsA = await req("GET", "/api/dms", { token: tokA });
const convA = (dmsA.data?.conversations ?? []).find((c) => c.withId === idB);
check("A's Messages lists B automatically", Boolean(convA), JSON.stringify(dmsA.data).slice(0, 200));
check("auto conversation is active (no request gate)", convA?.status === "active");
const dmsB = await req("GET", "/api/dms", { token: tokB });
check(
  "B's Messages lists A automatically",
  (dmsB.data?.conversations ?? []).some((c) => c.withId === idA)
);
const withB = await req("GET", `/api/dms/with/${idB}`, { token: tokA });
check(
  "/api/dms/with finds the thread",
  withB.status === 200 && withB.data?.conversation?.id === convA?.id
);
const dmSend = await req("POST", `/api/dms/${convA?.id}/messages`, {
  token: tokB,
  body: { body: "hey! quiz swap tonight?" },
});
check("buddies message immediately (201)", dmSend.status === 201, `got ${dmSend.status}`);

// --- Read-all notifications persist server-side (UX review item 3) ---
const beforeRead = await req("GET", "/api/notifications", { token: tokB });
check("B has unread notifications", (beforeRead.data?.unreadCount ?? 0) > 0);
const readAll = await req("POST", "/api/notifications/read", { token: tokB, body: {} });
check("read-all accepted", readAll.status === 200);
const afterRead = await req("GET", "/api/notifications", { token: tokB });
check("unread count is 0 after read-all", afterRead.data?.unreadCount === 0);

// --- Block silences every surface (UX review item 7) ---
const doBlock = await req("POST", "/api/dms/block", { token: tokA, body: { userId: idB, on: true } });
check("A blocks B", doBlock.status === 200 && doBlock.data?.blocked === true);
const blockedList = await req("GET", "/api/dms/blocked", { token: tokA });
check(
  "blocked list shows B",
  (blockedList.data?.blocked ?? []).some((b) => b.userId === idB)
);
const buddiesBlocked = await req("GET", "/api/buddies", { token: tokA });
check(
  "blocked buddy leaves the buddy list",
  !(buddiesBlocked.data?.buddies ?? []).some((b) => b.userId === idB)
);
const dmsBlocked = await req("GET", "/api/dms", { token: tokA });
check(
  "blocked thread leaves Messages",
  !(dmsBlocked.data?.conversations ?? []).some((c) => c.withId === idB)
);
const blockedSend = await req("POST", `/api/dms/${convA?.id}/messages`, {
  token: tokB,
  body: { body: "hello?" },
});
check("blocked user cannot message (403)", blockedSend.status === 403, `got ${blockedSend.status}`);
const matchesBlocked = await req("GET", "/api/buddies/matches", { token: tokA });
check(
  "blocked user leaves matches",
  !(matchesBlocked.data?.matches ?? []).some((m) => m.userId === idB)
);
const unblock = await req("POST", "/api/dms/block", { token: tokA, body: { userId: idB, on: false } });
check("unblock works", unblock.status === 200 && unblock.data?.blocked === false);
const buddiesBack = await req("GET", "/api/buddies", { token: tokA });
check(
  "unblock restores the buddy pair",
  (buddiesBack.data?.buddies ?? []).some((b) => b.userId === idB)
);

// --- Reporting a user reaches the moderation queue (UX review item 7) ---
const selfReport = await req("POST", `/api/users/${idA}/report`, {
  token: tokA,
  body: { reason: "spam" },
});
check("can't report yourself (400)", selfReport.status === 400, `got ${selfReport.status}`);
const badReason = await req("POST", `/api/users/${idB}/report`, {
  token: tokA,
  body: { reason: "nonsense" },
});
check("unknown reason rejected (400)", badReason.status === 400);
const report = await req("POST", `/api/users/${idB}/report`, {
  token: tokA,
  body: { reason: "harassment", detail: "smoke test report" },
});
check("user report lands (201)", report.status === 201, `got ${report.status}`);
if (process.env.CRON_SECRET) {
  const queue = await fetch(`${BASE}/api/ops/reports`, {
    headers: { "x-cron-secret": process.env.CRON_SECRET },
  }).then((r) => r.json());
  const row = (queue.reports ?? []).find(
    (r) => r.targetType === "user" && r.targetId === idB
  );
  check("ops queue shows the user report", Boolean(row), JSON.stringify(queue).slice(0, 200));
  check("queue names the reported user", /\[user\]/.test(row?.content ?? ""), row?.content);
}

// Editing the learning profile must NOT silently reset discoverability.
await req("PUT", "/api/onboarding", {
  token: tokA,
  body: { buddyPrefs: { similarLevel: false, availability: "mornings" } },
});
const stillOn = await req("GET", "/api/buddies/matches", { token: tokA });
check(
  "onboarding save preserves discoverability",
  stillOn.data?.discoverable === true
);

// Guests are locked out.
const guest = await req("POST", "/api/auth/guest", {});
const tokG = guest.data?.token;
const guestMatches = await req("GET", "/api/buddies/matches", { token: tokG });
check("guest blocked (403)", guestMatches.status === 403, `got ${guestMatches.status}`);

// Leave the matching pool the way we found it: this run's accounts go
// hidden again so they can't crowd future runs' top-10.
await req("POST", "/api/buddies/discoverable", { token: tokA, body: { on: false } });
await req("POST", "/api/buddies/discoverable", { token: tokB, body: { on: false } });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
