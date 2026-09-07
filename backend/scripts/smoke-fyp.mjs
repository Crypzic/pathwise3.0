// Personalized FYP end-to-end smoke (PATHWISE 2.0 Phase 15).
// Server must be running with AI_PROVIDER=mock.
// Usage: node scripts/smoke-fyp.mjs [baseUrl]
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

console.log(`FYP smoke against ${BASE}`);

const stamp = Date.now();
const su = await req("POST", "/api/auth/signup", {
  body: { name: "Feed Fan", email: `fyp-${stamp}@test.local`, password: "smoketest123" },
});
const tok = su.data?.token;
check("account created", Boolean(tok));
await req("POST", "/api/auth/accept-privacy", { token: tok });

// A fresh account still gets a feed (catalog fallback, no dead screen).
const cold = await req("GET", "/api/fyp", { token: tok });
check("cold-start feed is not empty", (cold.data?.feed ?? []).length >= 8, `got ${(cold.data?.feed ?? []).length}`);

// Give the learner context: declared subject + a real course whose topics
// overlap the seeded catalog via ops-added video (deterministic bridge).
await req("PUT", "/api/onboarding", {
  token: tok,
  body: { subjects: ["Biology"], topics: ["Immune System"] },
});

const course = await req("POST", "/api/courses", {
  token: tok,
  body: { name: "Feed Bridge Course" },
});
const courseId = course.data?.course?.id;
check("course created", Boolean(courseId));

const form = new FormData();
const buf = Buffer.alloc(4096, 7);
Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
form.append("file", new Blob([buf], { type: "image/png" }), "notes.png");
const up = await fetch(`${BASE}/api/courses/${courseId}/uploads`, {
  method: "POST",
  headers: { authorization: `Bearer ${tok}` },
  body: form,
});
check("upload processed (201)", up.status === 201, `got ${up.status}`);

// Find the course's topics, then plant a catalog video that names one —
// the quiz bridge must connect feed → that exact topic.
const detail = await req("GET", `/api/courses/${courseId}`, { token: tok });
const topics = detail.data?.course?.topics ?? [];
check("course has topics", topics.length > 0);
const bridgeTopic = topics[0]?.name;

const CRON_SECRET = process.env.CRON_SECRET ?? "";
let plantedId = null;
if (CRON_SECRET) {
  const res = await fetch(`${BASE}/api/ops/videos`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-cron-secret": CRON_SECRET,
    },
    body: JSON.stringify({
      title: `Deep dive: ${bridgeTopic}`,
      creator: "Smoke U",
      url: `https://example.edu/bridge-${stamp}`,
      subject: "Biology",
      topics: [bridgeTopic],
      durationSec: 300,
    }),
  });
  const data = await res.json();
  plantedId = data?.video?.id;
  check("planted a bridge video (201)", res.status === 201 && Boolean(plantedId));

  const feed = await req("GET", "/api/fyp", { token: tok });
  const rows = feed.data?.feed ?? [];
  const top = rows[0];
  // Prior smoke runs may have planted equal-scoring twins (mock topics are
  // deterministic), so assert the BEHAVIOR — a weak-topic video on top —
  // not which twin won the tiebreak.
  check(
    "a weak-topic video ranks first",
    top?.topics?.includes(bridgeTopic) === true,
    JSON.stringify({ top: top?.title, reason: top?.reason })
  );
  check("reason names the weak spot", /weak spot/i.test(top?.reason ?? ""), top?.reason ?? "");
  check(
    "feed carries the quiz action for that topic",
    top?.action?.courseId === courseId && top?.action?.topicName === bridgeTopic,
    JSON.stringify(top?.action)
  );

  // The learning bridge actually works: start the recommended quiz.
  const quiz = await req("POST", "/api/quiz/sessions", {
    token: tok,
    body: { courseId: top.action.courseId, kind: "practice", topicId: top.action.topicId },
  });
  check("recommended quiz starts (201)", quiz.status === 201, `got ${quiz.status}`);

  // Watch-history demotion: after viewing the bridge video, a FRESH video
  // on the same weak topic must outrank it. (A watched video correctly
  // stays on top when nothing fresh competes — demotion, not banishment.)
  await req("POST", `/api/videos/${plantedId}/engage`, { token: tok, body: { kind: "view" } });
  const res2 = await fetch(`${BASE}/api/ops/videos`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-cron-secret": CRON_SECRET,
    },
    body: JSON.stringify({
      title: `Another take on ${bridgeTopic}`,
      creator: "Smoke U",
      url: `https://example.edu/bridge2-${stamp}`,
      subject: "Biology",
      topics: [bridgeTopic],
      durationSec: 240,
    }),
  });
  const planted2 = (await res2.json())?.video?.id;
  check("planted a second bridge video (201)", res2.status === 201 && Boolean(planted2));

  const after = await req("GET", "/api/fyp", { token: tok });
  const ids = (after.data?.feed ?? []).map((v) => v.id);
  check(
    "fresh video on the same topic outranks the watched one",
    ids.indexOf(planted2) < ids.indexOf(plantedId),
    `fresh at ${ids.indexOf(planted2)}, watched at ${ids.indexOf(plantedId)}`
  );
} else {
  console.log("  (skipping bridge checks — CRON_SECRET not set)");
}

// Taste: like a CS video, CS content gains a because-you-liked reason.
const shelf = await req("GET", "/api/videos?subject=Computer Science", { token: tok });
const csVideo = (shelf.data?.videos ?? [])[0];
await req("POST", `/api/videos/${csVideo.id}/engage`, { token: tok, body: { kind: "like" } });
const tasteFeed = await req("GET", "/api/fyp", { token: tok });
check(
  "liking lifts similar content with a taste reason",
  (tasteFeed.data?.feed ?? []).some((v) => /you('ve)? liked/i.test(v.reason ?? "")),
  JSON.stringify((tasteFeed.data?.feed ?? []).slice(0, 3).map((v) => v.reason))
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
