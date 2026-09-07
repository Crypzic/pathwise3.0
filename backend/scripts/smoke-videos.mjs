// Curated videos end-to-end smoke (PATHWISE 2.0 Phase 14).
// Server must be running with CRON_SECRET set for the ops checks.
// Usage: CRON_SECRET=... node scripts/smoke-videos.mjs [baseUrl]
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

console.log(`Curated-videos smoke against ${BASE}`);

const stamp = Date.now();
const su = await req("POST", "/api/auth/signup", {
  body: { name: "Video Fan", email: `vid-${stamp}@test.local`, password: "smoketest123" },
});
const tok = su.data?.token;
check("account created", Boolean(tok));
await req("POST", "/api/auth/accept-privacy", { token: tok });

// Declare Biology interest so ranking has a signal.
await req("PUT", "/api/onboarding", {
  token: tok,
  body: { subjects: ["Biology"], topics: ["Immune System"] },
});

const shelf = await req("GET", "/api/videos", { token: tok });
const videos = shelf.data?.videos ?? [];
check("catalog seeded (>= 8 videos)", videos.length >= 8, `got ${videos.length}`);
check("subjects list present", (shelf.data?.subjects ?? []).includes("Biology"));

const top = videos[0];
check(
  "ranking puts a Biology/immune match on top",
  top?.subject === "Biology",
  JSON.stringify({ title: top?.title, reason: top?.reason })
);
check("top video explains WHY it's shown", Boolean(top?.reason), top?.reason ?? "");
check(
  "every video carries attribution + source link",
  videos.every((v) => v.creator && /^https?:\/\//.test(v.url))
);

// Subject filter.
const filtered = await req("GET", "/api/videos?subject=Mathematics", { token: tok });
check(
  "subject filter works",
  (filtered.data?.videos ?? []).length > 0 &&
    filtered.data.videos.every((v) => v.subject === "Mathematics")
);

// Engagement: like toggles, save toggles, views accumulate.
const like1 = await req("POST", `/api/videos/${top.id}/engage`, { token: tok, body: { kind: "like" } });
check("like turns on", like1.status === 200 && like1.data?.active === true);
const like2 = await req("POST", `/api/videos/${top.id}/engage`, { token: tok, body: { kind: "like" } });
check("like toggles off", like2.data?.active === false);
await req("POST", `/api/videos/${top.id}/engage`, { token: tok, body: { kind: "save" } });
const afterSave = await req("GET", "/api/videos", { token: tok });
check(
  "save persists into the shelf",
  (afterSave.data?.videos ?? []).find((v) => v.id === top.id)?.savedByMe === true
);
const view = await req("POST", `/api/videos/${top.id}/engage`, { token: tok, body: { kind: "view" } });
check("view records", view.status === 200);

// Guests: can browse, cannot engage.
const guest = await req("POST", "/api/auth/guest", {});
const tokG = guest.data?.token;
const guestShelf = await req("GET", "/api/videos", { token: tokG });
check("guest can browse the catalog", guestShelf.status === 200 && (guestShelf.data?.videos ?? []).length > 0);
const guestLike = await req("POST", `/api/videos/${top.id}/engage`, { token: tokG, body: { kind: "like" } });
check("guest cannot like/save (403)", guestLike.status === 403, `got ${guestLike.status}`);

// Ops: add, hide, and the student shelf reflects it.
if (CRON_SECRET) {
  const bad = await req("POST", "/api/ops/videos", {
    headers: { "x-cron-secret": CRON_SECRET },
    body: { title: "x", creator: "y", url: "nope", subject: "Physics" },
  });
  check("ops rejects invalid video (400)", bad.status === 400);

  const created = await req("POST", "/api/ops/videos", {
    headers: { "x-cron-secret": CRON_SECRET },
    body: {
      title: "Smoke Test Lecture",
      creator: "Smoke U",
      url: `https://example.edu/lecture-${stamp}`,
      subject: "Biology",
      topics: ["Immune System"],
      difficulty: 0.4,
      durationSec: 600,
    },
  });
  const newId = created.data?.video?.id;
  check("ops adds a video (201)", created.status === 201 && Boolean(newId));

  const afterAdd = await req("GET", "/api/videos", { token: tok });
  check(
    "new video reaches the student shelf",
    (afterAdd.data?.videos ?? []).some((v) => v.id === newId)
  );

  const hide = await req("POST", `/api/ops/videos/${newId}`, {
    headers: { "x-cron-secret": CRON_SECRET },
    body: { status: "hidden" },
  });
  check("ops hides it", hide.status === 200);
  const afterHide = await req("GET", "/api/videos", { token: tok });
  check(
    "hidden video leaves the shelf",
    !(afterHide.data?.videos ?? []).some((v) => v.id === newId)
  );
  const noAuth = await req("GET", "/api/ops/videos", {});
  check("ops list requires the secret (401)", noAuth.status === 401);
} else {
  console.log("  (skipping ops checks — CRON_SECRET not set)");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
