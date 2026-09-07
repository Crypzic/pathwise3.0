// Learning layer end-to-end smoke: topic breakdowns, Ask PATHWISE,
// two-phase quizzes (MCQ + written), flashcards.
// Server must be running with AI_PROVIDER=mock.
// Usage: node scripts/smoke-learning.mjs [baseUrl]
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

console.log(`Learning-layer smoke against ${BASE}`);

const stamp = Date.now();
const su = await req("POST", "/api/auth/signup", {
  body: { name: "Learner", email: `learn-${stamp}@test.local`, password: "smoketest123" },
});
const tok = su.data?.token;
check("account created", Boolean(tok));
await req("POST", "/api/auth/accept-privacy", { token: tok });

const course = await req("POST", "/api/courses", {
  token: tok,
  body: { name: "Learning Layer Course" },
});
const courseId = course.data?.course?.id;
const png = Buffer.alloc(4096, 7);
Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
const form = new FormData();
form.append("file", new Blob([png], { type: "image/png" }), "notes.png");
const up = await fetch(`${BASE}/api/courses/${courseId}/uploads`, {
  method: "POST",
  headers: { authorization: `Bearer ${tok}` },
  body: form,
});
check("upload processed (201)", up.status === 201, `got ${up.status}`);

const detail = await req("GET", `/api/courses/${courseId}`, { token: tok });
const topic = (detail.data?.course?.topics ?? [])[0];
check("topics mapped", Boolean(topic?.id));

// --- Topic breakdown: generated once, cached after.
const b1 = await req("GET", `/api/topics/${topic.id}/breakdown`, { token: tok });
check("breakdown generates (200)", b1.status === 200, JSON.stringify(b1.data).slice(0, 150));
check("breakdown has an overview + sections", (b1.data?.breakdown?.overview?.length ?? 0) > 0 && (b1.data?.breakdown?.sections?.length ?? 0) >= 1);
check("breakdown names its course", b1.data?.courseId === courseId);
check("first visit is a fresh generation", b1.data?.cached === false);

const b2 = await req("GET", `/api/topics/${topic.id}/breakdown`, { token: tok });
check("second visit is cached", b2.data?.cached === true);

// Ownership: another user can't read it.
const other = await req("POST", "/api/auth/signup", {
  body: { name: "Other", email: `learn-o-${stamp}@test.local`, password: "smoketest123" },
});
await req("POST", "/api/auth/accept-privacy", { token: other.data?.token });
const stolen = await req("GET", `/api/topics/${topic.id}/breakdown`, {
  token: other.data?.token,
});
check("breakdown is owner-only (404)", stolen.status === 404, `got ${stolen.status}`);

// --- Ask PATHWISE: explanatory mode — a real answer, not only a question.
const ask = await req("POST", `/api/topics/${topic.id}/ask`, {
  token: tok,
  body: { messages: [{ role: "user", content: "I don't get the main idea — can you explain it simply?" }] },
});
check("ask answers (200)", ask.status === 200, JSON.stringify(ask.data).slice(0, 120));
const reply = ask.data?.reply ?? "";
check("reply actually explains (not just a counter-question)", reply.length > 80);

// --- Two-phase quiz: MCQs then written answers.
const quiz = await req("POST", "/api/quiz/sessions", {
  token: tok,
  body: { courseId, kind: "practice", count: 3 },
});
const sessionId = quiz.data?.sessionId;
check("quiz starts (201)", quiz.status === 201 && Boolean(sessionId));
check("total includes the written phase", (quiz.data?.total ?? 0) >= 5, `total ${quiz.data?.total}`);

// Answer MCQs until the written phase begins.
let current = null;
let guard = 0;
let sawWritten = false;
let writtenResults = [];
while (guard++ < 15) {
  const s = await req("GET", `/api/quiz/sessions/${sessionId}`, { token: tok });
  current = s.data?.current;
  if (!current) break;
  if (current.kind === "written") {
    sawWritten = true;
    check("written item carries no options", (current.options?.length ?? 0) === 0);
    // First written: echo the mock's reference-answer vocabulary → correct.
    // Second: junk → incorrect.
    const isFirst = writtenResults.length === 0;
    const answerText = isFirst
      ? `${current.topicName} is a central concept — its core idea drives the surrounding material and later topics build on it.`
      : "idk banana";
    const a = await req("POST", `/api/quiz/sessions/${sessionId}/answer`, {
      token: tok,
      body: { answerText, timeMs: 9000 },
    });
    writtenResults.push(a.data?.result);
  } else {
    await req("POST", `/api/quiz/sessions/${sessionId}/answer`, {
      token: tok,
      body: { selectedIndex: 0, timeMs: 6000 },
    });
  }
}
check("written phase reached", sawWritten);
check("two written questions asked", writtenResults.length === 2, `got ${writtenResults.length}`);
const [good, bad] = writtenResults;
check(
  "substantive answer graded correct/close",
  good?.verdict === "correct" || good?.verdict === "close",
  JSON.stringify(good)
);
check("graded reply teaches (explanation present)", (good?.explanation?.length ?? 0) > 20);
check("model answer returned for comparison", (good?.referenceAnswer?.length ?? 0) > 0);
check("junk answer graded incorrect", bad?.verdict === "incorrect", JSON.stringify(bad));

// --- Flashcards from the finished quiz.
const review = await req("GET", `/api/quiz/sessions/${sessionId}/review`, { token: tok });
check("flashcards available after completion (200)", review.status === 200);
const cardList = review.data?.cards ?? [];
check("one card per question", cardList.length === (quiz.data?.total ?? 0), `got ${cardList.length}`);
check(
  "every card has both faces",
  cardList.every((c) => c.front?.length > 0 && c.back?.length > 0)
);

// Review is completed-quizzes-only: a fresh active session refuses.
const quiz2 = await req("POST", "/api/quiz/sessions", {
  token: tok,
  body: { courseId, kind: "practice", count: 2 },
});
const early = await req("GET", `/api/quiz/sessions/${quiz2.data?.sessionId}/review`, { token: tok });
check("flashcards locked until the quiz is finished (404)", early.status === 404, `got ${early.status}`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
