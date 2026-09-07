// Knowledge Layer 2.0 end-to-end smoke (PATHWISE 2.0 Phase 6).
// Server must be running with AI_PROVIDER=mock.
// Usage: node scripts/smoke-knowledge.mjs [baseUrl]
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

function fakePng(size = 4096) {
  const buf = Buffer.alloc(size, 7);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  return buf;
}

console.log(`Knowledge Layer smoke against ${BASE}`);

const email = `kl-smoke-${Date.now()}@test.local`;
const su = await req("POST", "/api/auth/signup", {
  body: { name: "KL Smoke", email, password: "smoketest123" },
});
const tok = su.data?.token;
check("signup ok", Boolean(tok));
await req("POST", "/api/auth/accept-privacy", { token: tok });

const course = await req("POST", "/api/courses", {
  token: tok,
  body: { name: "Concept Structure Course" },
});
const courseId = course.data?.course?.id;
check("course created", Boolean(courseId));

const up = await uploadFile(
  `/api/courses/${courseId}/uploads`,
  tok,
  "notes.png",
  "image/png",
  fakePng()
);
check("upload processed (201)", up.status === 201, `got ${up.status}`);

const detail = await req("GET", `/api/courses/${courseId}`, { token: tok });
const topics = detail.data?.course?.topics ?? [];
check("topics exist", topics.length > 0, `got ${topics.length}`);

const enriched = topics.filter((t) => (t.objectives?.length ?? 0) > 0);
check(
  "topics carry learning objectives",
  enriched.length > 0,
  JSON.stringify(topics[0] ?? {})
);
check(
  "topics carry difficulty",
  topics.some((t) => typeof t.difficulty === "number")
);
check(
  "at least one topic names a misconception",
  topics.some((t) => (t.misconceptions?.length ?? 0) > 0)
);
check(
  "at least one topic names a prerequisite",
  topics.some((t) => (t.prerequisites?.length ?? 0) > 0)
);
check(
  "source refs point at the uploaded file",
  topics.some((t) => (t.sourceRef ?? "").includes("notes.png"))
);

// Second upload with different bytes: the map should expand/enrich, and
// existing enrichment must survive (never clobbered).
const before = topics.find((t) => (t.objectives?.length ?? 0) > 0);
const up2 = await uploadFile(
  `/api/courses/${courseId}/uploads`,
  tok,
  "board.png",
  "image/png",
  fakePng(6000)
);
check("second upload processed (201)", up2.status === 201, `got ${up2.status}`);
const detail2 = await req("GET", `/api/courses/${courseId}`, { token: tok });
const topics2 = detail2.data?.course?.topics ?? [];
const after = topics2.find((t) => t.id === before?.id);
check(
  "existing enrichment survives a second upload",
  (after?.objectives?.length ?? 0) >= (before?.objectives?.length ?? 1)
);

// Quiz generation still works against enriched topics (regression).
const quiz = await req("POST", "/api/quiz/sessions", {
  token: tok,
  body: { courseId, kind: "practice", count: 4 },
});
check("quiz builds from enriched topics (201)", quiz.status === 201, `got ${quiz.status}`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
