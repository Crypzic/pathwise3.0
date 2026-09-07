// Dashboard (Step 8) — real per-course data: mastery heatmap, the guessing vs
// understanding view, streak, badges and deep-dive counts.
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import { api, ApiError } from "../lib/api";
import { useApi } from "../lib/useApi";
import {
  FlameIcon,
  AwardIcon,
  BrainIcon,
  SparklesIcon,
  ChartIcon,
} from "../components/icons";
import {
  EmptyState,
  ErrorState,
  InlineError,
  SkeletonRows,
} from "../components/states";

interface DashboardResponse {
  course: { id: string; name: string };
  confidence: {
    score: number;
    tier: string;
    components: { mastery: number; consistency: number; depth: number };
  };
  masteryPct: number;
  heatmap: {
    topicId: string;
    name: string;
    mastery: number;
    weight: number;
    attempted: boolean;
  }[];
  understanding: {
    understood: number;
    guessing: number;
    learning: number;
    assessed: number;
    unassessed: number;
    shakyTopics: { topicId: string; name: string }[];
  };
  stats: {
    streakCount: number;
    bestStreak: number;
    xp: number;
    rank: { level: number; name: string };
    badgeCount: number;
    deepDiveCount: number;
    quizCount: number;
    accuracy: number | null;
  };
  badges: { key: string; name: string; description: string; earnedAt: string }[];
}

const RING_CIRCUMFERENCE = 2 * Math.PI * 24;

function heatClass(mastery: number, attempted: boolean): string {
  if (!attempted) return "heat-cell";
  if (mastery >= 90) return "heat-cell heat-90";
  if (mastery >= 70) return "heat-cell heat-75";
  if (mastery >= 50) return "heat-cell heat-55";
  if (mastery >= 25) return "heat-cell heat-35";
  return "heat-cell heat-15";
}

/** No course id in the URL: pick the remembered one, else the first. */
function CoursePicker() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const remembered = localStorage.getItem("pathwise_last_course");
    api
      .get<{ courses: { id: string }[] }>("/api/courses")
      .then((res) => {
        const target =
          res.courses.find((c) => c.id === remembered)?.id ?? res.courses[0]?.id;
        if (target) navigate(`/progress/${target}`, { replace: true });
        else navigate("/courses", { replace: true });
      })
      .catch(() => setError("Couldn't load your courses."));
  }, [navigate]);

  return (
    <AppShell>
      {error ? <ErrorState message={error} /> : <SkeletonRows rows={4} />}
    </AppShell>
  );
}

export default function Dashboard() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, loading, error, reload } = useApi<DashboardResponse>(
    id ? `/api/courses/${id}/dashboard` : null
  );

  if (!id) return <CoursePicker />;

  async function talkThrough(topicId: string) {
    setActionError(null);
    try {
      const res = await api.post<{ session: { id: string } }>(
        "/api/socratic/sessions",
        { courseId: id, topicId, origin: "dashboard" }
      );
      navigate(`/socratic/chat/${res.session.id}`);
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Couldn't start Socratic mode."
      );
    }
  }

  if (loading) {
    return (
      <AppShell>
        <div className="skeleton" style={{ height: 22, width: 190, marginBottom: 12 }} />
        <div className="skeleton" style={{ height: 74, marginBottom: 24, borderRadius: "var(--r-lg)" }} />
        <SkeletonRows rows={4} />
      </AppShell>
    );
  }

  if (error || !data) {
    return (
      <AppShell>
        <ErrorState message={error ?? "Course not found."} onRetry={reload} />
      </AppShell>
    );
  }

  const { confidence, heatmap, understanding, stats, badges } = data;
  const dashOffset = RING_CIRCUMFERENCE * (1 - confidence.score / 100);
  // Gate on everything the student has been tested on, not just the topics
  // that have crossed 50% — otherwise a course in progress renders nothing.
  const assessed = understanding.assessed;

  return (
    <AppShell>
      <div className="eyebrow">{data.course.name}</div>
      <h1 className="section-title">Your progress</h1>

      <InlineError message={actionError} />

      <div className="confidence-widget" style={{ margin: "20px 0 24px 0", maxWidth: 420 }}>
        <div className="confidence-ring">
          <svg width="52" height="52" viewBox="0 0 56 56" aria-hidden="true">
            <circle cx="28" cy="28" r="24" stroke="var(--border)" strokeWidth="6" fill="none" />
            <circle
              cx="28"
              cy="28"
              r="24"
              stroke="var(--primary)"
              strokeWidth="6"
              fill="none"
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
            />
          </svg>
          <div className="pct">{confidence.score}%</div>
        </div>
        <div>
          <div className="confidence-label">{confidence.tier} — Course Confidence</div>
          <div className="confidence-sub">
            Mastery {confidence.components.mastery}% · Consistency{" "}
            {confidence.components.consistency}% · Depth {confidence.components.depth}%
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 14, marginBottom: 26, flexWrap: "wrap" }}>
        {[
          {
            icon: <FlameIcon cls="icon-sm" style={{ color: "var(--accent)" }} />,
            label: "STREAK",
            value: `${stats.streakCount} ${stats.streakCount === 1 ? "day" : "days"}`,
          },
          {
            icon: <AwardIcon cls="icon-sm" style={{ color: "var(--warning)" }} />,
            label: "BADGES",
            value: String(stats.badgeCount),
          },
          {
            icon: <BrainIcon cls="icon-sm" style={{ color: "var(--primary-dark)" }} />,
            label: "DEEP-DIVES",
            value: String(stats.deepDiveCount),
          },
          {
            icon: <ChartIcon cls="icon-sm" style={{ color: "var(--success)" }} />,
            label: "ACCURACY",
            value: stats.accuracy === null ? "—" : `${stats.accuracy}%`,
          },
        ].map((tile) => (
          <div key={tile.label} className="card" style={{ flex: 1, minWidth: 132 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
              {tile.icon}
              <span style={{ fontSize: 11.5, color: "var(--ink-soft)", fontWeight: 700 }}>
                {tile.label}
              </span>
            </div>
            <div className="mono" style={{ fontSize: 22, fontWeight: 700 }}>
              {tile.value}
            </div>
          </div>
        ))}
      </div>

      <h2 style={{ fontSize: 15, marginBottom: 14 }}>Mastery by topic</h2>
      {heatmap.length === 0 ? (
        <EmptyState
          icon={<ChartIcon cls="icon-lg" />}
          title="Nothing to chart yet"
          body="Upload course material to build a topic map, then take a quiz — your mastery heatmap fills in from there."
          action={
            <button className="btn btn-primary" onClick={() => navigate(`/courses/${id}`)}>
              Add material
            </button>
          }
        />
      ) : (
        <div className="heatmap-grid" style={{ marginBottom: 28 }}>
          {heatmap.map((t) => (
            <div
              key={t.topicId}
              className={heatClass(t.mastery, t.attempted)}
              style={
                t.attempted
                  ? undefined
                  : {
                      background: "var(--surface-alt)",
                      color: "var(--ink-faint)",
                      border: "1px dashed var(--border)",
                    }
              }
              title={`${t.name} — ${t.attempted ? `${t.mastery}% mastery` : "not yet assessed"}`}
            >
              <div className="t-name">{t.name}</div>
              <div className="t-pct">{t.attempted ? `${t.mastery}%` : "—"}</div>
            </div>
          ))}
        </div>
      )}

      {/* Step 8 item 2 — the honest version of the mastery number. */}
      {assessed > 0 && (
        <>
          <h2 style={{ fontSize: 15, marginBottom: 6 }}>Understanding vs guessing</h2>
          <p className="section-sub">
            Based on how quickly you answer and how much you reason things through.
          </p>

          <div className="card" style={{ marginBottom: 16 }}>
            <div
              style={{
                display: "flex",
                height: 12,
                borderRadius: 20,
                overflow: "hidden",
                marginBottom: 14,
                background: "var(--border)",
              }}
              role="img"
              aria-label={`${understanding.understood} topics understood, ${understanding.guessing} looking like guesswork, ${understanding.learning} still being learned`}
            >
              <div
                style={{
                  width: `${(understanding.understood / assessed) * 100}%`,
                  background: "var(--success)",
                }}
              />
              <div
                style={{
                  width: `${(understanding.guessing / assessed) * 100}%`,
                  background: "var(--warning)",
                }}
              />
              <div
                style={{
                  width: `${(understanding.learning / assessed) * 100}%`,
                  background: "var(--ink-faint)",
                }}
              />
            </div>

            <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontSize: 13 }}>
              <span>
                <strong>{understanding.understood}</strong> understood
              </span>
              <span>
                <strong>{understanding.guessing}</strong> looks like guesswork
              </span>
              <span>
                <strong>{understanding.learning}</strong> still learning
              </span>
              <span style={{ color: "var(--ink-faint)" }}>
                {understanding.unassessed} not yet assessed
              </span>
            </div>
          </div>

          {understanding.shakyTopics.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 28 }}>
              {understanding.shakyTopics.map((t) => (
                <div key={t.topicId} className="heat-list-row">
                  <span
                    className="heat-dot"
                    style={{ background: "var(--warning)" }}
                    aria-hidden="true"
                  />
                  <div className="t-name">{t.name}</div>
                  <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>
                    Right answers, shaky reasoning
                  </div>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 12, padding: "7px 12px" }}
                    onClick={() => talkThrough(t.topicId)}
                  >
                    <SparklesIcon cls="icon-sm" /> Talk it through
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {badges.length > 0 && (
        <>
          <h2 style={{ fontSize: 15, marginBottom: 14 }}>Badges earned</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 20 }}>
            {badges.map((b) => (
              <span key={b.key} className="pill pill-green" title={b.description}>
                <AwardIcon cls="icon-sm" /> {b.name}
              </span>
            ))}
          </div>
        </>
      )}
    </AppShell>
  );
}
