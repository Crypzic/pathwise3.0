// Onboarding end-to-end smoke (PATHWISE 2.0 Phase 2).
// Server must be running. Usage: node scripts/smoke-onboarding.mjs [baseUrl]
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

console.log(`Onboarding smoke against ${BASE}`);

// A guest is the cheapest identity to exercise the endpoints with.
const guest = await req("POST", "/api/auth/guest", { body: {} });
const tok = guest.data?.token;
check("session ready", Boolean(tok));

const empty = await req("GET", "/api/onboarding", { token: tok });
check("GET returns empty profile (200)", empty.status === 200, `got ${empty.status}`);
check("fresh profile not onboarded", empty.data?.profile?.onboarded === false);
check(
  "catalogs present",
  Array.isArray(empty.data?.catalog?.academicLevels) &&
    empty.data.catalog.academicLevels.length >= 4 &&
    Array.isArray(empty.data?.catalog?.contentPrefs)
);

const badLevel = await req("PUT", "/api/onboarding", {
  token: tok,
  body: { academicLevel: "wizard" },
});
check("unknown level rejected (400)", badLevel.status === 400, `got ${badLevel.status}`);

const partial = await req("PUT", "/api/onboarding", {
  token: tok,
  body: {
    field: "  Computer Science ",
    academicLevel: "undergraduate",
    subjects: ["  Algorithms ", "algorithms", "", "Databases"],
  },
});
check("partial save (200)", partial.status === 200, `got ${partial.status}`);
check("field trimmed", partial.data?.profile?.field === "Computer Science");
check(
  "subjects normalized + deduped",
  JSON.stringify(partial.data?.profile?.subjects) ===
    JSON.stringify(["Algorithms", "Databases"])
);
check("partial save does not complete", partial.data?.profile?.onboarded === false);

const done = await req("PUT", "/api/onboarding", {
  token: tok,
  body: {
    contentPrefs: ["exam_prep", "nonsense", "short_explanations"],
    studyStyle: "buddy",
    buddyPrefs: { similarLevel: true, availability: "evenings" },
    complete: true,
  },
});
check("complete save (200)", done.status === 200, `got ${done.status}`);
check("marked onboarded", done.data?.profile?.onboarded === true);
check(
  "content prefs filtered to catalog",
  JSON.stringify(done.data?.profile?.contentPrefs) ===
    JSON.stringify(["short_explanations", "exam_prep"])
);
check(
  "buddy prefs normalized",
  done.data?.profile?.buddyPrefs?.similarLevel === true &&
    done.data?.profile?.buddyPrefs?.availability === "evenings"
);
check(
  "earlier answers survive the second save",
  done.data?.profile?.field === "Computer Science"
);

const me = await req("GET", "/api/auth/me", { token: tok });
check("user payload carries onboarded=true", me.data?.user?.onboarded === true);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
