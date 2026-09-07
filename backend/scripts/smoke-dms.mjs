// Direct Messaging end-to-end smoke (PATHWISE 2.0 Phase 12).
// Server must be running; CRON_SECRET enables the moderation checks.
// Usage: CRON_SECRET=... node scripts/smoke-dms.mjs [baseUrl]
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

async function makeUser(name, email) {
  const su = await req("POST", "/api/auth/signup", {
    body: { name, email, password: "smoketest123" },
  });
  const token = su.data?.token;
  await req("POST", "/api/auth/accept-privacy", { token });
  const me = await req("GET", "/api/auth/me", { token });
  return { token, id: me.data?.user?.id };
}

console.log(`DM smoke against ${BASE}`);

const stamp = Date.now();
const A = await makeUser("DM A", `dm-a-${stamp}@test.local`);
const B = await makeUser("DM B", `dm-b-${stamp}@test.local`);
const C = await makeUser("DM C", `dm-c-${stamp}@test.local`);
check("three accounts created", Boolean(A.token) && Boolean(B.token) && Boolean(C.token));

// Make A and B buddies (opt in, request, accept).
await req("POST", "/api/buddies/discoverable", { token: A.token, body: { on: true } });
await req("POST", "/api/buddies/discoverable", { token: B.token, body: { on: true } });
// Overlap so they'd match; not strictly needed for a direct request.
await req("PUT", "/api/onboarding", { token: A.token, body: { subjects: ["Chemistry"] } });
await req("PUT", "/api/onboarding", { token: B.token, body: { subjects: ["Chemistry"] } });
await req("POST", "/api/buddies/requests", { token: A.token, body: { toId: B.id } });
const inboxB = await req("GET", "/api/buddies/requests", { token: B.token });
const reqId = inboxB.data?.incoming?.[0]?.id;
await req("POST", `/api/buddies/requests/${reqId}/respond`, { token: B.token, body: { action: "accept" } });
check("A and B are buddies", Boolean(reqId));

// Buddy DM: immediately active.
const dm1 = await req("POST", "/api/dms", {
  token: A.token,
  body: { toId: B.id, body: "Quiz swap tonight? I made 10 on stoichiometry." },
});
const convAB = dm1.data?.conversation?.id;
check("buddy conversation starts active", dm1.status === 201 && dm1.data?.conversation?.status === "active");

const reply = await req("POST", `/api/dms/${convAB}/messages`, {
  token: B.token,
  body: { body: "Deal. Loser explains every wrong answer." },
});
check("B replies (201)", reply.status === 201);

const listA = await req("GET", "/api/dms", { token: A.token });
const rowAB = (listA.data?.conversations ?? []).find((c) => c.id === convAB);
check("A's list shows the conversation with unread", Boolean(rowAB) && rowAB.unread === 1, JSON.stringify(rowAB));

const threadA = await req("GET", `/api/dms/${convAB}`, { token: A.token });
check("thread shows both messages", (threadA.data?.conversation?.messages ?? []).length === 2);

const listA2 = await req("GET", "/api/dms", { token: A.token });
const rowAB2 = (listA2.data?.conversations ?? []).find((c) => c.id === convAB);
check("reading clears unread", rowAB2?.unread === 0, `unread ${rowAB2?.unread}`);

// Non-buddy: message request flow. C -> B.
const dm2 = await req("POST", "/api/dms", {
  token: C.token,
  body: { toId: B.id, body: "Hey — saw you in the chemistry community. Study together?" },
});
const convCB = dm2.data?.conversation?.id;
check("non-buddy conversation starts pending", dm2.status === 201 && dm2.data?.conversation?.status === "pending");

const replyBlocked = await req("POST", `/api/dms/${convCB}/messages`, {
  token: B.token,
  body: { body: "should not send yet" },
});
check("recipient can't reply before accepting (403)", replyBlocked.status === 403, `got ${replyBlocked.status}`);

const listB = await req("GET", "/api/dms", { token: B.token });
const rowCB = (listB.data?.conversations ?? []).find((c) => c.id === convCB);
check("B sees it as an incoming request", rowCB?.incomingRequest === true);

const accept = await req("POST", `/api/dms/${convCB}/respond`, {
  token: B.token,
  body: { action: "accept" },
});
check("B accepts the request", accept.status === 200 && accept.data?.status === "active");

const replyNow = await req("POST", `/api/dms/${convCB}/messages`, {
  token: B.token,
  body: { body: "Sure — what topic are you on?" },
});
check("B can reply after accepting (201)", replyNow.status === 201);

// Only the recipient can respond to a pending request.
const dm3 = await req("POST", "/api/dms", {
  token: C.token,
  body: { toId: A.id, body: "you too?" },
});
const convCA = dm3.data?.conversation?.id;
const wrongResponder = await req("POST", `/api/dms/${convCA}/respond`, {
  token: C.token,
  body: { action: "accept" },
});
check("requester can't accept their own request (404)", wrongResponder.status === 404);

// Mute.
const mute = await req("POST", `/api/dms/${convCB}/mute`, { token: B.token, body: { on: true } });
check("mute works", mute.status === 200 && mute.data?.muted === true);

// Report a message into the ops queue; moderation blanks it.
const thread = await req("GET", `/api/dms/${convCB}`, { token: B.token });
const cMsg = (thread.data?.conversation?.messages ?? []).find((m) => !m.mine);
const report = await req("POST", `/api/dms/messages/${cMsg.id}/report`, {
  token: B.token,
  body: { reason: "spam" },
});
check("B reports C's message (201)", report.status === 201);

if (CRON_SECRET) {
  const queue = await req("GET", "/api/ops/reports", { headers: { "x-cron-secret": CRON_SECRET } });
  const row = (queue.data?.reports ?? []).find((r) => r.targetId === cMsg.id);
  check("ops queue shows the DM report", Boolean(row) && (row.content ?? "").includes("[dm]"));
  const resolve = await req("POST", `/api/ops/reports/${row.id}/resolve`, {
    headers: { "x-cron-secret": CRON_SECRET },
    body: { action: "remove" },
  });
  check("ops removes the message", resolve.status === 200);
  const after = await req("GET", `/api/dms/${convCB}`, { token: B.token });
  check(
    "moderated message is blanked",
    (after.data?.conversation?.messages ?? []).some((m) => m.body === "[removed by moderation]")
  );
} else {
  console.log("  (skipping ops checks — CRON_SECRET not set)");
}

// Block: B blocks C — messages stop in both directions.
const block = await req("POST", "/api/dms/block", { token: B.token, body: { userId: C.id, on: true } });
check("B blocks C", block.status === 200 && block.data?.blocked === true);

const cSends = await req("POST", `/api/dms/${convCB}/messages`, {
  token: C.token,
  body: { body: "hello?" },
});
check("blocked sender is refused (403)", cSends.status === 403, `got ${cSends.status}`);
const bSends = await req("POST", `/api/dms/${convCB}/messages`, {
  token: B.token,
  body: { body: "silence" },
});
check("blocker can't message the blocked either (403)", bSends.status === 403);

const newConv = await req("POST", "/api/dms", {
  token: C.token,
  body: { toId: B.id, body: "new try" },
});
check("blocked user can't start a fresh conversation (403)", newConv.status === 403);

// Spam screening applies to DMs.
const spam = await req("POST", `/api/dms/${convAB}/messages`, {
  token: A.token,
  body: { body: "https://a.com https://b.com https://c.com https://d.com buy now" },
});
check("spam screening blocks link floods (400)", spam.status === 400);

// Guests are locked out.
const guest = await req("POST", "/api/auth/guest", {});
const guestList = await req("GET", "/api/dms", { token: guest.data?.token });
check("guest blocked (403)", guestList.status === 403, `got ${guestList.status}`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
