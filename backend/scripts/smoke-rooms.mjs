// Study Buddy Rooms end-to-end smoke (PATHWISE 2.0 Phases 11/19).
// Server must be running with AI_PROVIDER=mock.
// Usage: node scripts/smoke-rooms.mjs [baseUrl]
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
  const me = await req("GET", "/api/auth/me", { token });
  return { token, id: me.data?.user?.id };
}

console.log(`Study-rooms smoke against ${BASE}`);

const stamp = Date.now();
const A = await makeUser("Room A", `room-a-${stamp}@test.local`);
const B = await makeUser("Room B", `room-b-${stamp}@test.local`);
const C = await makeUser("Room C", `room-c-${stamp}@test.local`);
check("three accounts created", Boolean(A.token) && Boolean(B.token) && Boolean(C.token));

// A and B become buddies.
await req("POST", "/api/buddies/discoverable", { token: A.token, body: { on: true } });
await req("POST", "/api/buddies/discoverable", { token: B.token, body: { on: true } });
await req("POST", "/api/buddies/requests", { token: A.token, body: { toId: B.id } });
const inbox = await req("GET", "/api/buddies/requests", { token: B.token });
await req("POST", `/api/buddies/requests/${inbox.data.incoming[0].id}/respond`, {
  token: B.token,
  body: { action: "accept" },
});

// Non-buddies can't open a room.
const denied = await req("POST", "/api/rooms", { token: A.token, body: { buddyId: C.id } });
check("non-buddies can't open a room (403)", denied.status === 403, `got ${denied.status}`);

// Buddies can; both directions land in the same room.
const roomA = await req("POST", "/api/rooms", { token: A.token, body: { buddyId: B.id } });
const roomId = roomA.data?.room?.id;
check("buddies open a room (201)", roomA.status === 201 && Boolean(roomId));
const roomB = await req("POST", "/api/rooms", { token: B.token, body: { buddyId: A.id } });
check("same pair maps to the same room", roomB.data?.room?.id === roomId);

// Chat both ways; outsider blocked.
await req("POST", `/api/rooms/${roomId}/messages`, {
  token: A.token,
  body: { content: "Okay — resonance structures. Want to each explain one and compare?" },
});
await req("POST", `/api/rooms/${roomId}/messages`, {
  token: B.token,
  body: { content: "Deal. I think the double bond can sit in two places because the electrons are delocalized?" },
});
const outsider = await req("GET", `/api/rooms/${roomId}`, { token: C.token });
check("outsider can't read the room (404)", outsider.status === 404);
const outsiderMsg = await req("POST", `/api/rooms/${roomId}/messages`, {
  token: C.token,
  body: { content: "let me in" },
});
check("outsider can't post (404)", outsiderMsg.status === 404);

const view = await req("GET", `/api/rooms/${roomId}`, { token: A.token });
check("both messages visible", (view.data?.room?.messages ?? []).length === 2);

// Focus topic.
const topic = await req("POST", `/api/rooms/${roomId}/topic`, {
  token: A.token,
  body: { topicName: "Resonance Structures" },
});
check("focus topic set", topic.status === 200 && topic.data?.topicName === "Resonance Structures");

// The facilitator waits for BOTH.
const helpA = await req("POST", `/api/rooms/${roomId}/help`, { token: A.token });
check("one-sided help request waits", helpA.status === 200 && helpA.data?.facilitated === false);
const midView = await req("GET", `/api/rooms/${roomId}`, { token: B.token });
check("partner sees the pending help request", midView.data?.room?.partnerWantsHelp === true);
check("no assistant message yet", !(midView.data?.room?.messages ?? []).some((m) => m.role === "assistant"));

const helpB = await req("POST", `/api/rooms/${roomId}/help`, { token: B.token });
check("second request triggers the facilitator", helpB.status === 200 && helpB.data?.facilitated === true, JSON.stringify(helpB.data).slice(0, 150));
const facilitated = helpB.data?.message?.content ?? "";
check("facilitator asks, never answers", facilitated.trim().endsWith("?"), facilitated.slice(0, 120));
check(
  "no answer-shaped facilitation",
  !/the answer is|correct answer/i.test(facilitated)
);

const afterView = await req("GET", `/api/rooms/${roomId}`, { token: A.token });
const messages = afterView.data?.room?.messages ?? [];
check("assistant message lands in the transcript", messages.some((m) => m.role === "assistant"));
check("help requests reset after intervention", afterView.data?.room?.myHelpPending === false && afterView.data?.room?.partnerWantsHelp === false);

// End the session; posting stops.
const end = await req("POST", `/api/rooms/${roomId}/end`, { token: B.token });
check("either side can end the room", end.status === 200);
const postAfterEnd = await req("POST", `/api/rooms/${roomId}/messages`, {
  token: A.token,
  body: { content: "still there?" },
});
check("ended room refuses messages (404)", postAfterEnd.status === 404);

// Reopening revives the same room with its transcript.
const reopen = await req("POST", "/api/rooms", { token: A.token, body: { buddyId: B.id } });
check("reopening revives the pair's room", reopen.data?.room?.id === roomId);
const revived = await req("GET", `/api/rooms/${roomId}`, { token: A.token });
check("transcript survives", (revived.data?.room?.messages ?? []).length >= 3);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
