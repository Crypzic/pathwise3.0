// Study Plan (Step 6) — real quests, confidence gauge, quest path and the
// supportive confidence-drop banner.
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import { api, ApiError } from "../lib/api";
import { useApi } from "../lib/useApi";
import {
  WindIcon,
  DnaIcon,
  SparklesIcon,
  LightbulbIcon,
  CheckIcon,
  AlertIcon,
  LockIcon,
  UploadIcon,
} from "../components/icons";
import { Collapsible } from "../components/Collapsible";
import { ErrorState, InlineError, SkeletonRows } from "../components/states";

interface Quest {
  id: string;
  kind: "quiz" | "review" | "socratic" | "upload";
  title: string;
  subtitle: string;
  xp: number;
  topicId: string | null;
  topicName: string | null;
  tone: "danger" | "warning" | "primary";
}

interface PlanResponse {
  plan: {
    courseId: string;
    courseName: string;
    confidence: {
      score: number;
      tier: string;
      components: { mastery: number; consistency: number; depth: number };
    };
    quests: Quest[];
    alert: { topicId: string; topicName: string; message: string } | null;
    path: {
      topicId: string;
      name: string;
      mastery: number;
      state: "mastered" | "mid" | "weak" | "locked";
    }[];
    masteryPct: number;
    dueCount: number;
    topicCount: number;
  };
  user: {
    xp: number;
    rank: { level: number; name: string };
    streakCount: number;
  };
}

const RING_CIRCUMFERENCE = 2 * Math.PI * 24; // r=24

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

const TONE_BG: Record<Quest["tone"], string> = {
  danger: "var(--danger-light)",
  warning: "var(--warning-light)",
  primary: "var(--primary-light)",
};
const TONE_FG: Record<Quest["tone"], string> = {
  danger: "#B94848",
  warning: "#8A6412",
  primary: "var(--primary-dark)",
};

function questIcon(kind: Quest["kind"]) {
  if (kind === "review") return <DnaIcon cls="icon" />;
  if (kind === "socratic") return <SparklesIcon cls="icon" />;
  if (kind === "upload") return <UploadIcon cls="icon" />;
  return <WindIcon cls="icon" />;
}

function beadClass(state: string): string {
  if (state === "mastered") return "path-bead bead-mastered";
  if (state === "mid") return "path-bead bead-mid";
  if (state === "weak") return "path-bead bead-weak";
  return "path-bead bead-locked";
}

export default function StudyPlan() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [starting, setStarting] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, loading, error, reload } = useApi<PlanResponse>(
    id ? `/api/courses/${id}/study-plan` : null
  );

  async function startQuest(quest: Quest) {
    if (!id) return;
    setActionError(null);

    if (quest.kind === "upload") {
      navigate(`/courses/${id}`);
      return;
    }

    setStarting(quest.id);
    try {
      if (quest.kind === "socratic") {
        const res = await api.post<{ session: { id: string } }>(
          "/api/socratic/sessions",
          { courseId: id, topicId: quest.topicId, origin: "study_plan" }
        );
        navigate(`/socratic/chat/${res.session.id}`);
        return;
      }

      const res = await api.post<{ sessionId: string }>("/api/quiz/sessions", {
        courseId: id,
        kind: quest.kind === "review" ? "review" : "practice",
        topicId: quest.topicId ?? undefined,
      });
      navigate(`/quiz/${res.sessionId}`);
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Couldn't start that just now."
      );
    } finally {
      setStarting(null);
    }
  }

  async function reviewFromBanner(topicId: string) {
    if (!id) return;
    setActionError(null);
    try {
      const res = await api.post<{ sessionId: string }>("/api/quiz/sessions", {
        courseId: id,
        kind: "review",
        topicId,
      });
      navigate(`/quiz/${res.sessionId}`);
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Couldn't start that review."
      );
    }
  }

  if (loading) {
    return (
      <AppShell>
        <div className="skeleton" style={{ height: 24, width: 200, marginBottom: 14 }} />
        <div className="skeleton" style={{ height: 76, marginBottom: 22, borderRadius: "var(--r-lg)" }} />
        <SkeletonRows rows={3} height={78} />
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

  const { plan, user } = data;
  const dashOffset = RING_CIRCUMFERENCE * (1 - plan.confidence.score / 100);

  return (
    <AppShell>
      <div className="topbar">
        <div>
          <div className="eyebrow">{plan.courseName}</div>
          <h1 className="section-title">{greeting()}</h1>
        </div>
        <div className="confidence-widget">
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
            <div className="pct">{plan.confidence.score}%</div>
          </div>
          <div>
            <div className="confidence-label">{plan.confidence.tier}</div>
            <div className="confidence-sub">Course confidence</div>
          </div>
        </div>
      </div>

      <InlineError message={actionError} />

      {plan.alert && (
        <div className="confidence-banner">
          <LightbulbIcon cls="icon" style={{ color: "#8A6412" }} />
          <div className="txt">{plan.alert.message}</div>
          <button
            className="btn btn-ghost"
            style={{ fontSize: 12, padding: "8px 14px" }}
            onClick={() => reviewFromBanner(plan.alert!.topicId)}
          >
            Review
          </button>
        </div>
      )}

      <div style={{ display: "flex", gap: 14, marginBottom: 28, flexWrap: "wrap" }}>
        <div className="card" style={{ flex: 1, minWidth: 130, textAlign: "center" }}>
          <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: "var(--primary)" }}>
            {user.xp.toLocaleString()}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--ink-soft)", fontWeight: 700 }}>
            TOTAL XP
          </div>
        </div>
        <div className="card" style={{ flex: 1, minWidth: 130, textAlign: "center" }}>
          <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: "var(--accent)" }}>
            Lv. {user.rank.level}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--ink-soft)", fontWeight: 700 }}>
            {user.rank.name.toUpperCase()} RANK
          </div>
        </div>
        <div className="card" style={{ flex: 1, minWidth: 130, textAlign: "center" }}>
          <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: "var(--success)" }}>
            {plan.masteryPct}%
          </div>
          <div style={{ fontSize: 11.5, color: "var(--ink-soft)", fontWeight: 700 }}>
            MASTERY
          </div>
        </div>
      </div>

      {plan.path.length > 0 && (
        <Collapsible title="Your quest path" defaultOpen={false}>
          <div className="quest-path" style={{ marginBottom: 0 }}>
            {plan.path.map((node, i) => (
              <div key={node.topicId} style={{ display: "flex", alignItems: "center" }}>
                {i > 0 && <div className="path-connector" />}
                <div className="path-node">
                  <div
                    className={beadClass(node.state)}
                    title={`${node.name} — ${node.mastery}%`}
                  >
                    {node.state === "mastered" ? (
                      <CheckIcon cls="icon-sm" />
                    ) : node.state === "weak" ? (
                      <AlertIcon cls="icon-sm" />
                    ) : node.state === "locked" ? (
                      <LockIcon cls="icon-sm" />
                    ) : (
                      <span style={{ fontSize: 12, fontWeight: 700 }}>{node.mastery}</span>
                    )}
                  </div>
                  <div className="path-label">{node.name}</div>
                </div>
              </div>
            ))}
          </div>
        </Collapsible>
      )}

      <h2 style={{ fontSize: 15, margin: "22px 0 14px 0" }}>
        Today's quests
        {plan.dueCount > 0 && (
          <span className="pill pill-coral" style={{ marginLeft: 10 }}>
            {plan.dueCount} due
          </span>
        )}
      </h2>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {plan.quests.map((q) => (
          <button
            key={q.id}
            className="quest-card"
            style={{ cursor: "pointer", textAlign: "left", width: "100%" }}
            onClick={() => startQuest(q)}
            disabled={starting !== null}
          >
            <div className="quest-icon" style={{ background: TONE_BG[q.tone], color: TONE_FG[q.tone] }}>
              {questIcon(q.kind)}
            </div>
            <div className="quest-meta">
              <div className="quest-title">{q.title}</div>
              <div className="quest-sub">
                {starting === q.id ? "Starting…" : q.subtitle}
              </div>
            </div>
            {q.xp > 0 && <span className="xp-chip">+{q.xp} XP</span>}
          </button>
        ))}
      </div>
    </AppShell>
  );
}
