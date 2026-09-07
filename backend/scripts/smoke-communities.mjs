// Communities end-to-end smoke (PATHWISE 2.0 Phase 9).
// Server must be running with CRON_SECRET set (for the ops checks).
// Usage: CRON_SECRET=... node scripts/smoke-communities.mjs [baseUrl]
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

console.log(`Communities smoke against ${BASE}`);

// Two real accounts + one guest.
const stamp = Date.now();
const suA = await req("POST", "/api/auth/signup", {
  body: { name: "Comm A", email: `comm-a-${stamp}@test.local`, password: "smoketest123" },
});
const tokA = suA.data?.token;
const suB = await req("POST", "/api/auth/signup", {
  body: { name: "Comm B", email: `comm-b-${stamp}@test.local`, password: "smoketest123" },
});
const tokB = suB.data?.token;
check("two accounts created", Boolean(tokA) && Boolean(tokB));
await req("POST", "/api/auth/accept-privacy", { token: tokA });
await req("POST", "/api/auth/accept-privacy", { token: tokB });

const guest = await req("POST", "/api/auth/guest", {});
const tokG = guest.data?.token;
check("guest created", Boolean(tokG));

// Browse: seeded subject tree present.
const list = await req("GET", "/api/communities", { token: tokA });
const communities = list.data?.communities ?? [];
check("communities seeded (>= 10 incl. children)", communities.length >= 10, `got ${communities.length}`);
const programming = communities.find((c) => c.slug === "programming");
const cs = communities.find((c) => c.slug === "computer-science");
check("roadmap tree exists (computer-science > programming)", Boolean(programming) && Boolean(cs) && programming.parentId === cs.id);

// Guests are locked out server-side.
const guestList = await req("GET", "/api/communities", { token: tokG });
check("guest blocked from communities (403)", guestList.status === 403, `got ${guestList.status}`);
const guestJoin = await req("POST", `/api/communities/${programming.id}/join`, { token: tokG });
check("guest blocked from joining (403)", guestJoin.status === 403);

// Join + post.
const join = await req("POST", `/api/communities/${programming.id}/join`, { token: tokA });
check("A joins programming", join.status === 200 && join.data?.joined === true);

const noMemberPost = await req("POST", `/api/communities/${programming.id}/posts`, {
  token: tokB,
  body: { kind: "question", title: "Should fail", body: "not a member yet" },
});
check("non-member cannot post (403)", noMemberPost.status === 403, `got ${noMemberPost.status}`);

const post = await req("POST", `/api/communities/${programming.id}/posts`, {
  token: tokA,
  body: {
    kind: "question",
    title: "How do closures capture variables?",
    body: "I keep expecting the loop variable to be frozen per iteration — what's actually captured?",
  },
});
const postId = post.data?.post?.id;
check("member posts a question (201)", post.status === 201 && Boolean(postId));

const spam = await req("POST", `/api/communities/${programming.id}/posts`, {
  token: tokA,
  body: { kind: "resource", title: "Check these", body: "https://a.com https://b.com https://c.com https://d.com" },
});
check("spam screening blocks link floods (400)", spam.status === 400);

// B joins and replies; reactions work.
await req("POST", `/api/communities/${programming.id}/join`, { token: tokB });
const replyRes = await req("POST", `/api/communities/posts/${postId}/replies`, {
  token: tokB,
  body: { body: "Think about WHEN the variable is read — at call time, not at definition time. What does that imply for var vs let?" },
});
const replyId = replyRes.data?.reply?.id;
check("B replies (201)", replyRes.status === 201 && Boolean(replyId));

const react = await req("POST", `/api/communities/replies/${replyId}/react`, { token: tokA });
check("A marks the reply helpful", react.status === 200 && react.data?.reacted === true);
const unreact = await req("POST", `/api/communities/replies/${replyId}/react`, { token: tokA });
check("reacting again toggles off", unreact.status === 200 && unreact.data?.reacted === false);

const detail = await req("GET", `/api/communities/posts/${postId}`, { token: tokB });
check("post detail shows the reply", (detail.data?.post?.replies?.length ?? 0) === 1);
check("membership gates reply box", detail.data?.post?.canReply === true);

// Community feed shows the post.
const feed = await req("GET", `/api/communities/${programming.id}`, { token: tokA });
check("community feed lists the post", (feed.data?.posts ?? []).some((p) => p.id === postId));

// Reporting + ops moderation queue.
const report = await req("POST", "/api/communities/reports", {
  token: tokB,
  body: { targetType: "post", targetId: postId, reason: "off_topic", detail: "smoke test report" },
});
check("B reports the post (201)", report.status === 201);

if (CRON_SECRET) {
  const queue = await req("GET", "/api/ops/reports", { headers: { "x-cron-secret": CRON_SECRET } });
  const row = (queue.data?.reports ?? []).find((r) => r.targetId === postId);
  check("ops queue shows the report with content", Boolean(row) && (row.content ?? "").includes("closures"));

  const resolve = await req("POST", `/api/ops/reports/${row.id}/resolve`, {
    headers: { "x-cron-secret": CRON_SECRET },
    body: { action: "remove" },
  });
  check("ops removes the reported post", resolve.status === 200);

  const afterFeed = await req("GET", `/api/communities/${programming.id}`, { token: tokA });
  check(
    "removed post disappears from the feed",
    !(afterFeed.data?.posts ?? []).some((p) => p.id === postId)
  );
  const gone = await req("GET", `/api/communities/posts/${postId}`, { token: tokA });
  check("removed post 404s directly", gone.status === 404);
} else {
  console.log("  (skipping ops checks — CRON_SECRET not set)");
}

// Author takedown of own reply.
const delReply = await req("DELETE", `/api/communities/replies/${replyId}`, { token: tokB });
check("author removes own reply", delReply.status === 200);

// Leave.
const leave = await req("POST", `/api/communities/${programming.id}/leave`, { token: tokA });
check("A leaves the community", leave.status === 200 && leave.data?.joined === false);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
