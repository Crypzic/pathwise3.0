// Creator infrastructure smoke (PATHWISE 2.0 Phase 16).
//
// Two modes, matching the flag it exists to prove:
//   default        — against a server with FEATURE_USER_VIDEO_POSTING=false:
//                    asserts ordinary users can't reach ANY creator surface,
//                    while internal testing (CRON_SECRET header) can run the
//                    whole pipeline in the dark.
//   FLAG_ON=1      — against a server with the flag true: asserts the full
//                    public loop (feed, like, comment, follow, guest gates).
// Usage: CRON_SECRET=... [FLAG_ON=1] node scripts/smoke-creator.mjs [baseUrl]
const BASE = process.argv[2] ?? "http://localhost:4000";
const CRON_SECRET = process.env.CRON_SECRET ?? "";
const FLAG_ON = process.env.FLAG_ON === "1";

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

function fakeMp4(title = "clip.mp4") {
  const buf = Buffer.alloc(4096, 3);
  buf.write("ftyp", 4, "latin1");
  return { buf, title };
}

// Long enough that the mock screener reads it as real course material.
const CLEAN_CAPTION =
  "A walkthrough of the light-dependent reactions and the Calvin cycle for " +
  "first-year biology: where the electrons come from, what ATP and NADPH " +
  "actually do, and why carbon fixation happens in the stroma. Includes a " +
  "worked exam question at the end.";

async function uploadVideo(token, { title, caption, extraHeaders } = {}) {
  const { buf } = fakeMp4();
  const form = new FormData();
  form.append("title", title ?? "How photosynthesis actually works");
  form.append("caption", caption ?? CLEAN_CAPTION);
  form.append("file", new Blob([buf], { type: "video/mp4" }), "clip.mp4");
  const res = await fetch(`${BASE}/api/creator/videos`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, ...(extraHeaders ?? {}) },
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

async function makeUser(name, email) {
  const su = await req("POST", "/api/auth/signup", {
    body: { name, email, password: "smoketest123" },
  });
  const token = su.data?.token;
  await req("POST", "/api/auth/accept-privacy", { token });
  const me = await req("GET", "/api/auth/me", { token });
  return { token, id: me.data?.user?.id };
}

console.log(`Creator smoke against ${BASE} (mode: ${FLAG_ON ? "flag ON" : "flag OFF"})`);

const stamp = Date.now();
const creator = await makeUser("Creator", `creator-${stamp}@test.local`);
const viewer = await makeUser("Viewer", `viewer-${stamp}@test.local`);
check("accounts created", Boolean(creator.token) && Boolean(viewer.token));

// Flag reflected in public config.
const config = await req("GET", "/api/config");
check(
  `config reports userVideoPosting=${FLAG_ON}`,
  config.data?.features?.userVideoPosting === FLAG_ON,
  JSON.stringify(config.data?.features)
);

if (!FLAG_ON) {
  // Ordinary users: every creator surface is a 404, indistinguishable from
  // a route that doesn't exist.
  const upload = await uploadVideo(creator.token);
  check("ordinary upload unreachable (404)", upload.status === 404, `got ${upload.status}`);
  const list = await req("GET", "/api/creator/videos", { token: creator.token });
  check("ordinary studio list unreachable (404)", list.status === 404);
  const feed = await req("GET", "/api/creator/feed", { token: viewer.token });
  check("public feed unreachable (404)", feed.status === 404);

  // Internal testing: the same endpoints work with the ops secret.
  const internal = await uploadVideo(creator.token, {
    extraHeaders: { "x-cron-secret": CRON_SECRET },
  });
  check("internal upload works (201)", internal.status === 201, JSON.stringify(internal.data).slice(0, 200));
  const video = internal.data?.video;
  check("analysis ran (topics + moderation verdict)", (video?.topics?.length ?? 0) > 0 && video?.moderationStatus === "approved", JSON.stringify(video));
  check("upload lands private + pending review", video?.visibility === "private" && video?.status === "pending_review");

  const publish = await req("POST", `/api/creator/videos/${video.id}/publish`, {
    token: creator.token,
    headers: { "x-cron-secret": CRON_SECRET },
  });
  check("internal publish works", publish.status === 200 && publish.data?.video?.status === "published");

  // Even a PUBLISHED video reaches no ordinary user while the flag is off.
  const feedAfter = await req("GET", "/api/creator/feed", { token: viewer.token });
  check("published content still unreachable publicly (404)", feedAfter.status === 404);

  // The FLAGGED lane: thin metadata gets held for a human. Publish is
  // refused until ops approves — then it works.
  const thin = await uploadVideo(creator.token, {
    title: "Quick clip",
    caption: "watch this",
    extraHeaders: { "x-cron-secret": CRON_SECRET },
  });
  const thinVideo = thin.data?.video;
  check("thin metadata gets flagged for review", thinVideo?.moderationStatus === "flagged", JSON.stringify(thinVideo));
  const blockedPublish = await req("POST", `/api/creator/videos/${thinVideo.id}/publish`, {
    token: creator.token,
    headers: { "x-cron-secret": CRON_SECRET },
  });
  check("flagged video cannot publish (409)", blockedPublish.status === 409, `got ${blockedPublish.status}`);
  const approve = await req("POST", `/api/ops/creator-videos/${thinVideo.id}/moderate`, {
    headers: { "x-cron-secret": CRON_SECRET },
    body: { action: "approve" },
  });
  check("ops approves the flagged video", approve.status === 200);
  const publishNow = await req("POST", `/api/creator/videos/${thinVideo.id}/publish`, {
    token: creator.token,
    headers: { "x-cron-secret": CRON_SECRET },
  });
  check("publish works after human approval", publishNow.status === 200);

  // A bad upload is rejected inside the internal path too.
  const junkForm = new FormData();
  junkForm.append("title", "Disguised executable");
  junkForm.append("file", new Blob([Buffer.from("MZ not a video")], { type: "video/mp4" }), "evil.mp4");
  const junk = await fetch(`${BASE}/api/creator/videos`, {
    method: "POST",
    headers: { authorization: `Bearer ${creator.token}`, "x-cron-secret": CRON_SECRET },
    body: junkForm,
  });
  check("magic-byte check rejects disguised file (415)", junk.status === 415, `got ${junk.status}`);
} else {
  // Flag ON: the full loop, no secret needed.
  const upload = await uploadVideo(creator.token);
  const video = upload.data?.video;
  check("creator uploads (201)", upload.status === 201 && Boolean(video?.id));
  check("analysis approved it", video?.moderationStatus === "approved");

  const early = await req("GET", "/api/creator/feed", { token: viewer.token });
  check("unpublished video not in feed", !(early.data?.feed ?? []).some((v) => v.id === video.id));

  const publish = await req("POST", `/api/creator/videos/${video.id}/publish`, { token: creator.token });
  check("creator publishes (200)", publish.status === 200);

  const feed = await req("GET", "/api/creator/feed", { token: viewer.token });
  const row = (feed.data?.feed ?? []).find((v) => v.id === video.id);
  check("published video reaches the public feed", Boolean(row), JSON.stringify(feed.data).slice(0, 150));
  check("feed row credits the creator", Boolean(row?.creator));

  const like = await req("POST", `/api/creator/videos/${video.id}/interact`, {
    token: viewer.token,
    body: { kind: "like" },
  });
  check("viewer likes it", like.status === 200 && like.data?.active === true);
  const view = await req("POST", `/api/creator/videos/${video.id}/interact`, {
    token: viewer.token,
    body: { kind: "view", watchMs: 42000, completed: true },
  });
  check("view with watch telemetry records", view.status === 200);
  const comment = await req("POST", `/api/creator/videos/${video.id}/comments`, {
    token: viewer.token,
    body: { body: "The Calvin cycle part finally clicked — thanks!" },
  });
  check("viewer comments (201)", comment.status === 201);
  const follow = await req("POST", "/api/creator/follow", {
    token: viewer.token,
    body: { creatorId: creator.id, on: true },
  });
  check("viewer follows the creator", follow.status === 200 && follow.data?.following === true);

  const guest = await req("POST", "/api/auth/guest", {});
  const guestLike = await req("POST", `/api/creator/videos/${video.id}/interact`, {
    token: guest.data?.token,
    body: { kind: "like" },
  });
  check("guest cannot interact (403)", guestLike.status === 403, `got ${guestLike.status}`);

  // Report → ops queue → removal (the moderation loop end to end).
  await req("POST", `/api/creator/videos/${video.id}/interact`, {
    token: viewer.token,
    body: { kind: "report" },
  });
  if (CRON_SECRET) {
    const queue = await req("GET", "/api/ops/reports", { headers: { "x-cron-secret": CRON_SECRET } });
    const report = (queue.data?.reports ?? []).find((r) => r.targetId === video.id);
    check("report reaches the ops queue with content", Boolean(report) && /creator_video/.test(report.content ?? ""));
    const resolve = await req("POST", `/api/ops/reports/${report.id}/resolve`, {
      headers: { "x-cron-secret": CRON_SECRET },
      body: { action: "remove" },
    });
    check("ops removal takes it down", resolve.status === 200);
    const feedAfter = await req("GET", "/api/creator/feed", { token: viewer.token });
    check("removed video leaves the feed", !(feedAfter.data?.feed ?? []).some((v) => v.id === video.id));
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
