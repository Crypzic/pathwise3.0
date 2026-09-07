// Socratic Mode explainer (Step 7 item 4) — shown before the first session.
// Keeps the fixed dark theme so the mode reads as its own space regardless of
// the app's light/dark setting.
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { SparklesIcon, ArrowLeftIcon, ShieldIcon } from "../components/icons";

interface CourseOption {
  id: string;
  name: string;
  topicCount: number;
}

export default function Socratic() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user, patchUser } = useAuth();

  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [courseId, setCourseId] = useState(params.get("courseId") ?? "");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ courses: CourseOption[] }>("/api/courses")
      .then((res) => {
        // A course with no topics has nothing to reason about yet.
        const withTopics = res.courses.filter((c) => c.topicCount > 0);
        setCourses(withTopics);
        setCourseId((prev) => prev || withTopics[0]?.id || "");
      })
      .catch(() => setError("Couldn't load your courses."));
  }, []);

  async function begin() {
    if (!courseId) {
      setError("Add a course with some material first.");
      return;
    }
    setStarting(true);
    setError(null);
    try {
      // Record that the explainer has been seen, so it isn't shown again.
      if (!user?.socraticIntroSeen) {
        await api.post("/api/socratic/intro-seen").catch(() => {});
        patchUser({ socraticIntroSeen: true });
      }
      const res = await api.post<{ session: { id: string } }>(
        "/api/socratic/sessions",
        { courseId, origin: "dashboard" }
      );
      navigate(`/socratic/chat/${res.session.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't start a session.");
      setStarting(false);
    }
  }

  return (
    <div className="socratic-shell">
      <div className="socratic-header">
        <button
          onClick={() => navigate("/courses")}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--soc-text-soft)",
            fontSize: 13.5,
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <ArrowLeftIcon cls="icon-sm" /> Back
        </button>
        <span
          className="pill"
          style={{ background: "rgba(255,255,255,0.08)", color: "var(--soc-text-soft)" }}
        >
          <ShieldIcon cls="icon-sm" /> Integrity-safe
        </span>
      </div>

      <div className="socratic-intro-card">
        <SparklesIcon
          cls="icon-lg"
          style={{ margin: "0 auto 14px auto", color: "var(--soc-accent)" }}
        />
        <h1 style={{ color: "var(--soc-text)", fontSize: 20, marginBottom: 10 }}>
          Thinking Together
        </h1>
        <p
          style={{
            color: "var(--soc-text-soft)",
            fontSize: 13.5,
            lineHeight: 1.6,
            marginBottom: 18,
          }}
        >
          Socratic Mode won't give you answers — not even if you ask directly. It
          asks questions back until you find the answer yourself. That's slower,
          and it's the reason it actually sticks.
        </p>

        <div style={{ textAlign: "left", marginBottom: 20 }}>
          {[
            "It never states the answer, a definition, or a worked solution.",
            "It won't confirm whether your guess is right — it asks what led you there.",
            "Your reasoning depth feeds your mastery score, not just your quiz results.",
          ].map((line) => (
            <div
              key={line}
              style={{
                display: "flex",
                gap: 10,
                marginBottom: 10,
                fontSize: 12.5,
                color: "var(--soc-text-soft)",
                lineHeight: 1.5,
              }}
            >
              <span style={{ color: "var(--soc-accent)", fontWeight: 700 }}>—</span>
              {line}
            </div>
          ))}
        </div>

        {courses.length > 1 && (
          <div className="field" style={{ textAlign: "left" }}>
            <label htmlFor="soc-course" style={{ color: "var(--soc-text-soft)" }}>
              Course
            </label>
            <select
              id="soc-course"
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
              style={{
                background: "var(--soc-bg-alt)",
                color: "var(--soc-text)",
                borderColor: "var(--soc-border)",
              }}
            >
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {error && (
          <p style={{ color: "#F6A8A8", fontSize: 12.5, marginBottom: 14 }} role="alert">
            {error}
          </p>
        )}

        <button
          className="btn btn-primary btn-block"
          style={{ background: "var(--soc-accent)", boxShadow: "none" }}
          onClick={begin}
          disabled={starting || courses.length === 0}
        >
          {starting ? "Starting…" : "Start thinking"}
        </button>

        {courses.length === 0 && (
          <p style={{ color: "var(--soc-text-soft)", fontSize: 12, marginTop: 12 }}>
            You'll need a course with uploaded material first.
          </p>
        )}
      </div>
    </div>
  );
}
