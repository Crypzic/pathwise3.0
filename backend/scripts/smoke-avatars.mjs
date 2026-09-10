// Profile picture + frame smoke: upload, public serving, caching,
// persistence across re-login (the "photo disappeared" bug class),
// frame gating, delete. Server must be running.
// Usage: node scripts/smoke-avatars.mjs [baseUrl]
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

// Tiny valid 1x1 PNG (signature-checked server-side).
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==",
  "base64"
);

const email = `avatar-smoke-${Date.now()}@test.local`;
const password = "smoketest123";

const signup = await fetch(`${BASE}/api/auth/signup`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "Ava Tester", email, password, timezone: "UTC" }),
});
const { token, user } = await signup.json();
check("signup", signup.ok, `status ${signup.status}`);
check(
  "starts with no photo + classic frame",
  user?.avatarUrl === null && user?.avatarFrame === "classic"
);
const auth = { Authorization: `Bearer ${token}` };

// Upload.
const form = new FormData();
form.append("file", new Blob([PNG], { type: "image/png" }), "me.png");
const up = await fetch(`${BASE}/api/profile/avatar`, { method: "POST", headers: auth, body: form });
const upBody = await up.json().catch(() => ({}));
check("avatar upload 200", up.ok, `status ${up.status} ${JSON.stringify(upBody)}`);
check(
  "upload returns a per-user avatar url",
  typeof upBody.avatarUrl === "string" && upBody.avatarUrl.includes(`/api/users/${user.id}/avatar`)
);

// Public serving — no auth header, immutable caching, bytes intact.
const img = await fetch(`${BASE}${(upBody.avatarUrl ?? "").split("?")[0]}`);
check("public avatar GET 200", img.status === 200, `status ${img.status}`);
check("served as image/png", (img.headers.get("content-type") ?? "").includes("image/png"));
check("immutable cache header", (img.headers.get("cache-control") ?? "").includes("immutable"));
check("bytes round-trip", Buffer.from(await img.arrayBuffer()).equals(PNG));

// A renamed non-image must not get through.
const badForm = new FormData();
badForm.append("file", new Blob([Buffer.from("not an image")], { type: "image/png" }), "fake.png");
const bad = await fetch(`${BASE}/api/profile/avatar`, { method: "POST", headers: auth, body: badForm });
check("fake image rejected", bad.status === 400 || bad.status === 415, `status ${bad.status}`);

// Frames: free one works, locked one is enforced, unknown rejected.
const halo = await fetch(`${BASE}/api/profile/frame`, {
  method: "POST",
  headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify({ frame: "halo" }),
});
check("free frame selectable", halo.ok, `status ${halo.status}`);
const prismatic = await fetch(`${BASE}/api/profile/frame`, {
  method: "POST",
  headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify({ frame: "prismatic" }),
});
check("locked frame enforced (403)", prismatic.status === 403, `status ${prismatic.status}`);
const bogus = await fetch(`${BASE}/api/profile/frame`, {
  method: "POST",
  headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify({ frame: "nonsense" }),
});
check("unknown frame rejected (400)", bogus.status === 400, `status ${bogus.status}`);

// THE PERSISTENCE CHECK: a brand-new session (fresh signin = logout/login)
// must still see the photo and frame — server state, not client state.
const signin = await fetch(`${BASE}/api/auth/signin`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
}).then((r) => r.json());
check(
  "photo survives logout/login",
  typeof signin.user?.avatarUrl === "string",
  JSON.stringify(signin.user?.avatarUrl)
);
check("frame survives logout/login", signin.user?.avatarFrame === "halo");
const auth2 = { Authorization: `Bearer ${signin.token}` };
const me2 = await fetch(`${BASE}/api/auth/me`, { headers: auth2 }).then((r) => r.json());
check("me endpoint agrees after re-login", typeof me2.user?.avatarUrl === "string");

// Replace: a second upload rotates the path (cache-safe) and persists.
const form2 = new FormData();
form2.append("file", new Blob([PNG], { type: "image/png" }), "me2.png");
const up2 = await fetch(`${BASE}/api/profile/avatar`, { method: "POST", headers: auth2, body: form2 });
const up2Body = await up2.json().catch(() => ({}));
check("replacement upload 200", up2.ok, `status ${up2.status}`);
check(
  "replacement rotates the url",
  typeof up2Body.avatarUrl === "string" && up2Body.avatarUrl !== upBody.avatarUrl
);

// Delete → public URL 404s.
const del = await fetch(`${BASE}/api/profile/avatar`, { method: "DELETE", headers: auth2 });
check("avatar delete 200", del.ok, `status ${del.status}`);
const gone = await fetch(`${BASE}/api/users/${user.id}/avatar`);
check("avatar 404 after delete", gone.status === 404, `status ${gone.status}`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
