// Curated educational videos + personalized feed (PATHWISE 2.0 Phases
// 14-15). "For you" is the FYP: ranked on mastery gaps, course topics and
// taste from likes/saves, with a "quiz yourself" bridge back into the
// learning loop wherever a video maps onto the learner's own topics.
// Subject chips browse the raw curated catalog. Links open at the source
// with full attribution.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import { api, ApiError } from "../lib/api";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { PuzzleIcon, SparklesIcon } from "../components/icons";
import { EmptyState, ErrorState, InlineError, SkeletonRows } from "../components/states";

interface VideoRow {
  id: string;
  title: string;
  creator: string;
  url: string;
  thumbnailUrl: string | null;
  subject: string;
  topics: string[];
  difficulty?: number | null;
  durationSec: number | null;
  reason: string | null;
  likedByMe: boolean;
  savedByMe: boolean;
  /** FYP only: the watch → quiz bridge. */
  action?: { topicId: string; courseId: string; topicName: string } | null;
}

function minutes(sec: number | null): string | null {
  if (!sec) return null;
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`;
}

export default function Videos() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [subject, setSubject] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // The catalog powers the subject chips + filtered browsing; the FYP
  // powers the "For you" tab. Both stay loaded so switching is instant.
  const shelf = useApi<{ videos: VideoRow[]; subjects: string[] }>(
    subject ? `/api/videos?subject=${encodeURIComponent(subject)}` : "/api/videos",
    [subject]
  );
  const fyp = useApi<{ feed: VideoRow[] }>("/api/fyp");

  const showingFeed = subject === null;
  const { loading, error, reload } = showingFeed ? fyp : shelf;
  const rows = showingFeed ? fyp.data?.feed ?? [] : shelf.data?.videos ?? [];

  async function engage(v: VideoRow, kind: "like" | "save") {
    try {
      const res = await api.post<{ kind: string; active: boolean }>(
        `/api/videos/${v.id}/engage`,
        { kind }
      );
      const patch = (row: VideoRow) =>
        row.id === v.id
          ? {
              ...row,
              likedByMe: kind === "like" ? res.active : row.likedByMe,
              savedByMe: kind === "save" ? res.active : row.savedByMe,
            }
          : row;
      if (shelf.data) {
        shelf.setData({ ...shelf.data, videos: shelf.data.videos.map(patch) });
      }
      if (fyp.data) {
        fyp.setData({ feed: fyp.data.feed.map(patch) });
      }
    } catch {
      // Guests get a 403 — the buttons are hidden for them anyway.
    }
  }

  async function quizFrom(v: VideoRow) {
    if (!v.action) return;
    setActionError(null);
    try {
      const res = await api.post<{ sessionId: string }>("/api/quiz/sessions", {
        courseId: v.action.courseId,
        kind: "practice",
        topicId: v.action.topicId,
      });
      navigate(`/quiz/${res.sessionId}`);
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Couldn't start a quiz."
      );
    }
  }

  function watched(v: VideoRow) {
    // Fire-and-forget view signal; the link itself opens via the anchor.
    if (!user?.isGuest) {
      void api.post(`/api/videos/${v.id}/engage`, { kind: "view" }).catch(() => {});
    }
  }

  return (
    <AppShell>
      <div className="page-head">
        <div>
          <h1 className="page-title">Videos</h1>
          <p className="page-sub">
            Hand-picked explanations matched to your courses. Links open at
            the source — full credit to the creators.
          </p>
        </div>
      </div>

      {(shelf.data?.subjects.length ?? 0) > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          <button
            className={subject === null ? "pill pill-coral" : "pill pill-muted"}
            style={{ cursor: "pointer", border: "none" }}
            onClick={() => setSubject(null)}
          >
            For you
          </button>
          {shelf.data!.subjects.map((s) => (
            <button
              key={s}
              className={subject === s ? "pill pill-coral" : "pill pill-muted"}
              style={{ cursor: "pointer", border: "none" }}
              onClick={() => setSubject(s)}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <InlineError message={actionError} />

      {loading ? (
        <SkeletonRows rows={4} height={96} />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<SparklesIcon cls="icon-lg" />}
          title="Nothing here yet"
          body="The catalog is curated by hand and growing — check another subject."
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {rows.map((v) => (
            <div key={v.id} className="card" style={{ padding: 14, display: "flex", gap: 14, flexWrap: "wrap" }}>
              <div
                style={{ flexShrink: 0, cursor: "pointer" }}
                onClick={() => { watched(v); navigate(`/videos/${v.id}`); }}
                aria-label={`Watch ${v.title} inside Pathwise`}
              >
                {v.thumbnailUrl ? (
                  <img
                    src={v.thumbnailUrl}
                    alt=""
                    style={{ width: 168, height: 94, objectFit: "cover", borderRadius: 10 }}
                    loading="lazy"
                  />
                ) : (
                  <div
                    aria-hidden="true"
                    style={{
                      width: 168,
                      height: 94,
                      borderRadius: 10,
                      background: "linear-gradient(135deg, var(--accent-light, #dce7e2), var(--surface))",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 12.5,
                      color: "var(--ink-soft)",
                      fontWeight: 650,
                    }}
                  >
                    {v.subject}
                  </div>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div
                  onClick={() => { watched(v); navigate(`/videos/${v.id}`); }}
                  style={{ fontWeight: 700, fontSize: 14.5, color: "var(--ink)", cursor: "pointer" }}
                >
                  {v.title}
                </div>
                <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 3 }}>
                  {[v.creator, v.subject, minutes(v.durationSec)].filter(Boolean).join(" · ")}
                </div>
                {v.reason && (
                  <span className="pill pill-coral" style={{ fontSize: 10.5, marginTop: 8, display: "inline-block" }}>
                    {v.reason}
                  </span>
                )}
                {!user?.isGuest && (
                  <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                    <button
                      className={v.likedByMe ? "pill pill-coral" : "pill pill-muted"}
                      style={{ cursor: "pointer", border: "none", fontSize: 11.5 }}
                      onClick={() => engage(v, "like")}
                      aria-pressed={v.likedByMe}
                    >
                      👍 {v.likedByMe ? "Liked" : "Like"}
                    </button>
                    <button
                      className={v.savedByMe ? "pill pill-coral" : "pill pill-muted"}
                      style={{ cursor: "pointer", border: "none", fontSize: 11.5 }}
                      onClick={() => engage(v, "save")}
                      aria-pressed={v.savedByMe}
                    >
                      🔖 {v.savedByMe ? "Saved" : "Save"}
                    </button>
                    {v.action && (
                      <button
                        className="btn btn-primary"
                        style={{ fontSize: 11.5, padding: "4px 10px", display: "inline-flex", alignItems: "center", gap: 6 }}
                        onClick={() => quizFrom(v)}
                        title="A short quiz on this topic updates your mastery"
                      >
                        <PuzzleIcon cls="icon-sm" /> Quiz yourself on {v.action.topicName}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
