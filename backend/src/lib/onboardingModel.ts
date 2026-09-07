// Onboarding rules (PATHWISE 2.0 Phase 2) — pure functions and catalogs, no
// database or config imports. The route layer (routes/onboarding.ts) persists
// what these normalize; later phases (recommendations, communities, matching)
// read the same catalogs so keys stay consistent across the product.

/** Academic levels a learner can pick — keys are stored, labels are shown. */
export const ACADEMIC_LEVELS = [
  { key: "high_school", label: "High school" },
  { key: "undergraduate", label: "Undergraduate" },
  { key: "graduate", label: "Graduate / postgraduate" },
  { key: "professional", label: "Professional / certification" },
  { key: "self_taught", label: "Self-taught / curious" },
] as const;

/** What kind of learning content the learner responds to. */
export const CONTENT_PREFS = [
  { key: "short_explanations", label: "Short, clear explanations" },
  { key: "deep_lectures", label: "In-depth lectures" },
  { key: "exam_prep", label: "Exam prep" },
  { key: "practice_problems", label: "Practice problems" },
  { key: "real_world_examples", label: "Real-world examples" },
  { key: "step_by_step", label: "Step-by-step walkthroughs" },
] as const;

/** How the learner likes to study — feeds buddy matching later. */
export const STUDY_STYLES = [
  { key: "solo", label: "On my own" },
  { key: "buddy", label: "With a study buddy" },
  { key: "group", label: "In a group" },
  { key: "mixed", label: "Depends on the day" },
] as const;

/** When a study partner would fit the learner's schedule. */
export const AVAILABILITY = [
  { key: "mornings", label: "Mornings" },
  { key: "afternoons", label: "Afternoons" },
  { key: "evenings", label: "Evenings" },
  { key: "weekends", label: "Weekends" },
  { key: "flexible", label: "Flexible" },
] as const;

const LEVEL_KEYS = new Set<string>(ACADEMIC_LEVELS.map((l) => l.key));
const CONTENT_KEYS = new Set<string>(CONTENT_PREFS.map((c) => c.key));
const STYLE_KEYS = new Set<string>(STUDY_STYLES.map((s) => s.key));
const AVAILABILITY_KEYS = new Set<string>(AVAILABILITY.map((a) => a.key));

export function isAcademicLevel(v: string): boolean {
  return LEVEL_KEYS.has(v);
}
export function isStudyStyle(v: string): boolean {
  return STYLE_KEYS.has(v);
}
export function isAvailability(v: string): boolean {
  return AVAILABILITY_KEYS.has(v);
}

/** Keep only known content-preference keys, deduped, in catalog order. */
export function normalizeContentPrefs(values: string[]): string[] {
  const wanted = new Set(values.filter((v) => CONTENT_KEYS.has(v)));
  return CONTENT_PREFS.map((c) => c.key).filter((k) => wanted.has(k));
}

/**
 * Normalize a free-text list (subjects, topics, community interests): trim,
 * drop empties, collapse inner whitespace, dedupe case-insensitively keeping
 * the first spelling, cap item length and list size. User text is data, so
 * it is bounded here rather than trusted.
 */
export function normalizeFreeList(
  values: string[],
  { maxItems = 12, maxLength = 60 }: { maxItems?: number; maxLength?: number } = {}
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const cleaned = raw.replace(/\s+/g, " ").trim().slice(0, maxLength).trim();
    if (cleaned.length === 0) continue;
    const fold = cleaned.toLowerCase();
    if (seen.has(fold)) continue;
    seen.add(fold);
    out.push(cleaned);
    if (out.length >= maxItems) break;
  }
  return out;
}

export interface BuddyPrefs {
  similarLevel: boolean;
  sameSubjects: boolean;
  availability: string | null;
  // Study Buddy Matching (2.0 Phase 10): nobody is matchable until they
  // explicitly opt in. Privacy default is OFF.
  discoverable: boolean;
}

/** Coerce arbitrary stored/submitted JSON into a well-formed BuddyPrefs. */
export function normalizeBuddyPrefs(value: unknown): BuddyPrefs {
  const v = (value ?? {}) as Record<string, unknown>;
  const availability =
    typeof v.availability === "string" && isAvailability(v.availability)
      ? v.availability
      : null;
  return {
    similarLevel: v.similarLevel === true,
    sameSubjects: v.sameSubjects === true,
    availability,
    discoverable: v.discoverable === true,
  };
}

/** Parse a stored JSON string array defensively — bad data reads as empty. */
export function parseStoredList(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}
