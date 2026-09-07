// Personalized onboarding wizard (PATHWISE 2.0 Phase 2).
//
// Four short steps, every one skippable — the goal is signal, not friction.
// The same screen doubles as the "learning profile" editor from Profile:
// answers are prefilled from GET /api/onboarding and saved step by step.
import { useEffect, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { LogoMark } from "../components/Logo";

interface CatalogEntry {
  key: string;
  label: string;
}

interface OnboardingProfile {
  field: string | null;
  academicLevel: string | null;
  subjects: string[];
  topics: string[];
  contentPrefs: string[];
  communityInterests: string[];
  studyStyle: string | null;
  buddyPrefs: {
    similarLevel: boolean;
    sameSubjects: boolean;
    availability: string | null;
  };
  onboarded: boolean;
}

interface OnboardingResponse {
  profile: OnboardingProfile;
  catalog: {
    academicLevels: CatalogEntry[];
    contentPrefs: CatalogEntry[];
    studyStyles: CatalogEntry[];
    availability: CatalogEntry[];
  };
}

/** Selectable chip, used for every catalog choice. */
function Chip({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="btn"
      aria-pressed={selected}
      style={{
        padding: "8px 14px",
        borderRadius: 999,
        fontSize: 13,
        fontWeight: 600,
        border: selected
          ? "1.5px solid var(--primary)"
          : "1.5px solid var(--line)",
        background: selected ? "var(--primary-light, #eef2ff)" : "transparent",
        color: selected ? "var(--primary)" : "var(--ink-soft)",
      }}
    >
      {label}
    </button>
  );
}

/** Free-text tag list: Enter or comma adds, × removes. */
function TagInput({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState("");

  function commit() {
    const cleaned = draft.replace(/,/g, " ").replace(/\s+/g, " ").trim();
    setDraft("");
    if (!cleaned) return;
    if (values.some((v) => v.toLowerCase() === cleaned.toLowerCase())) return;
    onChange([...values, cleaned].slice(0, 12));
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit();
    } else if (e.key === "Backspace" && draft === "" && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  }

  return (
    <div>
      {values.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
          {values.map((v) => (
            <span
              key={v}
              className="pill"
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              {v}
              <button
                type="button"
                onClick={() => onChange(values.filter((x) => x !== v))}
                aria-label={`Remove ${v}`}
                style={{
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                  color: "inherit",
                  fontWeight: 700,
                  padding: 0,
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        onBlur={commit}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      <p style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 6 }}>
        Press Enter after each one.
      </p>
    </div>
  );
}

const STEP_COUNT = 4;

export default function Onboarding() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [data, setData] = useState<OnboardingResponse | null>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Draft state, prefilled from the saved profile.
  const [field, setField] = useState("");
  const [level, setLevel] = useState<string | null>(null);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [topics, setTopics] = useState<string[]>([]);
  const [contentPrefs, setContentPrefs] = useState<string[]>([]);
  const [interests, setInterests] = useState<string[]>([]);
  const [style, setStyle] = useState<string | null>(null);
  const [similarLevel, setSimilarLevel] = useState(false);
  const [sameSubjects, setSameSubjects] = useState(false);
  const [availability, setAvailability] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<OnboardingResponse>("/api/onboarding")
      .then((res) => {
        setData(res);
        const p = res.profile;
        setField(p.field ?? "");
        setLevel(p.academicLevel);
        setSubjects(p.subjects);
        setTopics(p.topics);
        setContentPrefs(p.contentPrefs);
        setInterests(p.communityInterests);
        setStyle(p.studyStyle);
        setSimilarLevel(p.buddyPrefs.similarLevel);
        setSameSubjects(p.buddyPrefs.sameSubjects);
        setAvailability(p.buddyPrefs.availability);
      })
      .catch(() => setError("Couldn't load onboarding. Try again in a moment."));
  }, []);

  function payload() {
    return {
      field,
      academicLevel: level ?? "",
      subjects,
      topics,
      contentPrefs,
      communityInterests: interests,
      studyStyle: style ?? "",
      buddyPrefs: { similarLevel, sameSubjects, availability },
    };
  }

  async function save(complete: boolean) {
    setBusy(true);
    setError(null);
    try {
      await api.put("/api/onboarding", { ...payload(), complete });
      if (complete) {
        // The user object carries `onboarded` — refresh so guards see it.
        await refresh();
        navigate("/courses");
      }
    } catch {
      setError("Couldn't save that. Check your connection and try again.");
      throw new Error("save failed");
    } finally {
      setBusy(false);
    }
  }

  async function next() {
    try {
      if (step < STEP_COUNT - 1) {
        await save(false);
        setStep((s) => s + 1);
      } else {
        await save(true);
      }
    } catch {
      // Error already surfaced; stay on the step.
    }
  }

  async function skip() {
    try {
      await save(true);
    } catch {
      // Error surfaced; stay.
    }
  }

  if (!data) {
    return (
      <div className="auth-wrap">
        <p style={{ color: "var(--ink-soft)" }} role="status">
          {error ?? "Loading…"}
        </p>
      </div>
    );
  }

  const { catalog } = data;

  const steps = [
    {
      title: "What do you study?",
      hint: "This shapes what Pathwise suggests — you can change it anytime.",
      body: (
        <>
          <div className="field">
            <label>Your field</label>
            <input
              value={field}
              onChange={(e) => setField(e.target.value)}
              placeholder="e.g. Computer Science, Law, Biology"
              maxLength={80}
            />
          </div>
          <div className="field">
            <label>Level</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {catalog.academicLevels.map((l) => (
                <Chip
                  key={l.key}
                  label={l.label}
                  selected={level === l.key}
                  onClick={() => setLevel(level === l.key ? null : l.key)}
                />
              ))}
            </div>
          </div>
        </>
      ),
    },
    {
      title: "Your courses right now",
      hint: "Subjects you're taking, and topics you want to get better at.",
      body: (
        <>
          <div className="field">
            <label>Subjects / courses</label>
            <TagInput
              values={subjects}
              onChange={setSubjects}
              placeholder="e.g. Contract Law"
            />
          </div>
          <div className="field">
            <label>Topics of interest</label>
            <TagInput
              values={topics}
              onChange={setTopics}
              placeholder="e.g. Offer and acceptance"
            />
          </div>
        </>
      ),
    },
    {
      title: "How do you like to learn?",
      hint: "Pick as many as you want.",
      body: (
        <>
          <div className="field">
            <label>Content that works for you</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {catalog.contentPrefs.map((c) => (
                <Chip
                  key={c.key}
                  label={c.label}
                  selected={contentPrefs.includes(c.key)}
                  onClick={() =>
                    setContentPrefs((prev) =>
                      prev.includes(c.key)
                        ? prev.filter((k) => k !== c.key)
                        : [...prev, c.key]
                    )
                  }
                />
              ))}
            </div>
          </div>
          <div className="field">
            <label>Communities you'd join</label>
            <TagInput
              values={interests}
              onChange={setInterests}
              placeholder="e.g. Law students"
            />
          </div>
        </>
      ),
    },
    {
      title: "Studying with others",
      hint: "For study-buddy matching later — nothing is shared without you.",
      body: (
        <>
          <div className="field">
            <label>Your style</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {catalog.studyStyles.map((s) => (
                <Chip
                  key={s.key}
                  label={s.label}
                  selected={style === s.key}
                  onClick={() => setStyle(style === s.key ? null : s.key)}
                />
              ))}
            </div>
          </div>
          <div className="field">
            <label>A good study partner…</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5 }}>
                <input
                  type="checkbox"
                  checked={similarLevel}
                  onChange={(e) => setSimilarLevel(e.target.checked)}
                />
                is around my level
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5 }}>
                <input
                  type="checkbox"
                  checked={sameSubjects}
                  onChange={(e) => setSameSubjects(e.target.checked)}
                />
                studies the same subjects
              </label>
            </div>
          </div>
          <div className="field">
            <label>When you usually study</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {catalog.availability.map((a) => (
                <Chip
                  key={a.key}
                  label={a.label}
                  selected={availability === a.key}
                  onClick={() =>
                    setAvailability(availability === a.key ? null : a.key)
                  }
                />
              ))}
            </div>
          </div>
        </>
      ),
    },
  ];

  const current = steps[step];

  return (
    <div className="auth-wrap">
      <div className="auth-card" style={{ width: 480 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 18,
          }}
        >
          <LogoMark size={30} />
          <button
            type="button"
            onClick={skip}
            disabled={busy}
            style={{
              border: "none",
              background: "none",
              cursor: "pointer",
              color: "var(--ink-soft)",
              fontSize: 12.5,
              fontWeight: 600,
            }}
          >
            Skip for now
          </button>
        </div>

        {/* Progress dots */}
        <div
          style={{ display: "flex", gap: 6, marginBottom: 18 }}
          aria-label={`Step ${step + 1} of ${STEP_COUNT}`}
        >
          {steps.map((_, i) => (
            <span
              key={i}
              aria-hidden="true"
              style={{
                height: 5,
                flex: 1,
                borderRadius: 999,
                background: i <= step ? "var(--primary)" : "var(--line)",
              }}
            />
          ))}
        </div>

        <h1 style={{ fontSize: 21, marginBottom: 4 }}>{current.title}</h1>
        <p style={{ color: "var(--ink-soft)", fontSize: 13, marginBottom: 20 }}>
          {current.hint}
        </p>

        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}

        {current.body}

        <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
          {step > 0 && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setStep((s) => s - 1)}
              disabled={busy}
              style={{ flex: 1 }}
            >
              Back
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            onClick={next}
            disabled={busy}
            style={{ flex: 2 }}
          >
            {busy
              ? "Saving…"
              : step === STEP_COUNT - 1
                ? "Finish"
                : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
