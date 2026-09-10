// Live real-AI end-to-end test (Gate 0 helper).
//
// Runs the ENTIRE learning pipeline against the RUNNING server with its
// REAL configured provider: builds a genuine syllabus DOCX in memory,
// signs up a fresh account, uploads it, and prints what the AI actually
// produced — topics with Knowledge-Layer detail, a full topic breakdown,
// an Ask-PATHWISE reply, and the first quiz question — so a human can
// judge quality. Costs a few cents per run on a real provider.
//
// Usage (server must be running with the real provider configured):
//   node scripts/live-ai-test.mjs [baseUrl]
import JSZip from "jszip";

const BASE = process.argv[2] ?? "http://localhost:4000";

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

// --- A real syllabus, generated as a real DOCX -----------------------------

const SYLLABUS_PARAGRAPHS = [
  "BIO 201: Introduction to Cell Biology — Course Syllabus",
  "This course covers the structure and function of cells, the fundamental units of life. Students will develop a mechanistic understanding of how cells maintain themselves, produce energy, divide, and communicate.",
  "Week 1-2: Cell Membranes and Transport. Phospholipid bilayers, membrane proteins, passive and active transport, osmosis and diffusion. Learning objective: predict the direction of water movement across a membrane given solute concentrations.",
  "Week 3-4: Mitochondria and Cellular Respiration. Glycolysis, the Krebs cycle, the electron transport chain, and ATP synthesis. Common misconception: ATP is not stored energy like a battery — it is continuously produced and consumed.",
  "Week 5: Photosynthesis. Light-dependent reactions and the Calvin cycle. Chloroplast structure. How photosynthesis and respiration are complementary processes.",
  "Week 6-7: Cell Division. Mitosis and meiosis, the cell cycle and its checkpoints, and what goes wrong in cancer. Students frequently confuse mitosis and meiosis — pay careful attention to the differences in outcomes and purpose.",
  "Week 8-9: DNA Replication and Protein Synthesis. Semiconservative replication, transcription, translation, and the genetic code. Learning objective: trace a gene from DNA sequence to functional protein.",
  "Week 10: The Immune System. Innate versus adaptive immunity, antibodies, and how vaccines train immune memory.",
  "Assessment: two midterms (weeks 5 and 9) weighted 25% each, a final exam worth 40%, and weekly quizzes worth 10%. The final emphasizes cellular respiration, cell division, and protein synthesis — the three pillars of the course.",
];

async function buildDocx() {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );
  const paragraphs = SYLLABUS_PARAGRAPHS.map(
    (text) =>
      `<w:p><w:r><w:t xml:space="preserve">${text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")}</w:t></w:r></w:p>`
  ).join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}</w:body></w:document>`
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

// --- The run ----------------------------------------------------------------

console.log(`\n══ LIVE AI TEST against ${BASE} ══`);
const health = await req("GET", "/api/health");
console.log(`Provider: ${health.data?.aiProvider} · routing: ${JSON.stringify(health.data?.aiRouting)}`);
if (health.data?.aiProvider === "mock") {
  console.log("⚠️  Server is on the MOCK provider — this test only means something on a real one.");
}

const stamp = Date.now();
const su = await req("POST", "/api/auth/signup", {
  body: { name: "Live Test", email: `live-${stamp}@test.local`, password: "livetest123" },
});
const tok = su.data?.token;
if (!tok) {
  console.error("Signup failed:", su.status, JSON.stringify(su.data));
  process.exit(1);
}
await req("POST", "/api/auth/accept-privacy", { token: tok });

const course = await req("POST", "/api/courses", {
  token: tok,
  body: { name: "BIO 201 Cell Biology" },
});
const courseId = course.data?.course?.id;
console.log(`\n[1/5] Course created. Uploading a real syllabus DOCX…`);

const docx = await buildDocx();
const form = new FormData();
form.append(
  "file",
  new Blob([docx], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  }),
  "bio201-syllabus.docx"
);
const upStart = Date.now();
const up = await fetch(`${BASE}/api/courses/${courseId}/uploads`, {
  method: "POST",
  headers: { authorization: `Bearer ${tok}` },
  body: form,
});
const upBody = await up.json().catch(() => ({}));
console.log(`Upload: HTTP ${up.status} in ${((Date.now() - upStart) / 1000).toFixed(1)}s`);
if (up.status !== 201) {
  console.error("Upload failed:", JSON.stringify(upBody).slice(0, 300));
  process.exit(1);
}

const detail = await req("GET", `/api/courses/${courseId}`, { token: tok });
const topics = detail.data?.course?.topics ?? [];
console.log(`\n[2/5] TOPICS EXTRACTED (${topics.length}) — judge: are these BIO 201's real topics?`);
for (const t of topics) {
  console.log(`  • ${t.name}  (weight ${t.weight}${t.difficulty != null ? `, difficulty ${t.difficulty}` : ""})`);
  if (t.summary) console.log(`      ${t.summary}`);
  if (t.objectives?.length) console.log(`      objectives: ${t.objectives.join(" | ")}`);
  if (t.misconceptions?.length) console.log(`      watch out: ${t.misconceptions.join(" | ")}`);
}
if (topics.length === 0) process.exit(1);

const target = topics[0];
console.log(`\n[3/5] TOPIC BREAKDOWN for "${target.name}" (first generation takes ~15-40s)…`);
const bdStart = Date.now();
const bd = await req("GET", `/api/topics/${target.id}/breakdown`, { token: tok });
console.log(`Breakdown: HTTP ${bd.status} in ${((Date.now() - bdStart) / 1000).toFixed(1)}s`);
if (bd.status === 200) {
  const b = bd.data.breakdown;
  console.log(`  OVERVIEW: ${b.overview}`);
  console.log(`  SECTIONS: ${b.sections.map((s) => s.heading).join(" · ")}`);
  console.log(`  FIRST SECTION (excerpt): ${b.sections[0].body.slice(0, 350)}…`);
  if (b.misconceptions?.length) {
    console.log(`  MYTH vs TRUTH: "${b.misconceptions[0].myth}" → "${b.misconceptions[0].truth}"`);
  }
  console.log(`  SUMMARY: ${b.summary}`);
} else {
  console.log(`  ${JSON.stringify(bd.data).slice(0, 200)}`);
}

console.log(`\n[4/5] ASK PATHWISE: "What's the difference between this and what I'd learn in high school?"`);
const ask = await req("POST", `/api/topics/${target.id}/ask`, {
  token: tok,
  body: {
    messages: [
      { role: "user", content: "What's the difference between this topic here and what I'd have learned about it in high school biology?" },
    ],
  },
});
console.log(ask.status === 200 ? `  REPLY: ${ask.data.reply.slice(0, 450)}…` : `  HTTP ${ask.status}: ${JSON.stringify(ask.data).slice(0, 200)}`);

console.log(`\n[5/5] QUIZ (generation is a real AI call)…`);
const quiz = await req("POST", "/api/quiz/sessions", {
  token: tok,
  body: { courseId, kind: "practice", count: 4 },
});
if (quiz.status === 201) {
  const sess = await req("GET", `/api/quiz/sessions/${quiz.data.sessionId}`, { token: tok });
  const q = sess.data?.current;
  console.log(`  Total questions: ${sess.data?.session?.total} (incl. written phase)`);
  console.log(`  Q1 [${q?.topicName}]: ${q?.question}`);
  (q?.options ?? []).forEach((o, i) => console.log(`     ${"ABCD"[i]}. ${o}`));
} else {
  console.log(`  HTTP ${quiz.status}: ${JSON.stringify(quiz.data).slice(0, 200)}`);
}

console.log(`\n══ DONE — judge the output above like a student would. ══`);
