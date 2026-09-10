// Curated educational videos + personalized feed (PATHWISE 2.0 Phases
// 14-15). "For you" is the FYP: ranked on mastery gaps, course topics and
// taste from likes/saves, with a "quiz yourself" bridge back into the
// learning loop wherever a video maps onto the learner's own topics.
// Subject chips browse the raw curated catalog. Links open at the source
// with full attribution.
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import { api, ApiError } from "../lib/api";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { PuzzleIcon, SparklesIcon } from "../components/icons";
import { EmptyState, ErrorState, InlineError, SkeletonRows } from "../components/states";

interface YouTubeRow {
  videoId: string;
  title: string;
  channel: string;
  thumbnailUrl: string | null;
  url: string;
}

/** A YouTube result card — always opens at the source. */
function YouTubeCard({ v }: { v: YouTubeRow }) {
  return (
    <a
      href={v.url}
      target="_blank"
      rel="noreferrer noopener"
      className="card"
      style={{
        padding: 10,
        display: "flex",
        gap: 12,
        alignItems: "center",
        color: "var(--ink)",
        textDecoration: "none",
      }}
    >
      {v.thumbnailUrl ? (
        <img
          src={v.thumbnailUrl}
          alt=""
          style={{ width: 120, borderRadius: 8, flexShrink: 0 }}
        />
      ) : (
        <div
          aria-hidden="true"
          style={{
            width: 120,
            height: 68,
            borderRadius: 8,
            background: "var(--surface-alt)",
            flexShrink: 0,
          }}
        />
      )}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 650, fontSize: 13.5, lineHeight: 1.35 }}>
          {v.title}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 4 }}>
          {v.channel} · YouTube
        </div>
      </div>
    </a>
  );
}

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
  // Interest-mapped YouTube strips (2.0 spec §3) — empty without a key.
  const suggestions = useApi<{
    suggestions: { reason: string; videos: YouTubeRow[] }[];
    youtubeConfigured: boolean;
  }>("/api/videos/suggestions");

  // Search: free text → AI intent → YouTube, via our backend only.
  const [searchDraft, setSearchDraft] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<{
    query: string;
    refinedQuery: string;
    results: YouTubeRow[];
    youtubeConfigured: boolean;
  } | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  async function runSearch(e: FormEvent) {
    e.preventDefault();
    const q = searchDraft.trim();
    if (q.length < 2 || searching) return;
    setSearching(true);
    setSearchError(null);
    try {
      const res = await api.get<{
        query: string;
        refinedQuery: string;
        results: YouTubeRow[];
        youtubeConfigured: boolean;
      }>(`/api/videos/search?q=${encodeURIComponent(q)}`);
      setSearchResult(res);
    } catch (err) {
      setSearchError(err instanceof ApiError ? err.message : "Search failed.");
    } finally {
      setSearching(false);
    }
  }

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
            Explanations matched to your courses — watch picks right here,
            search all of YouTube, full credit to the creators.
          </p>
        </div>
      </div>

      <form
        onSubmit={runSearch}
        role="search"
        style={{ display: "flex", gap: 8, marginBottom: 14 }}
      >
        <label className="sr-only" htmlFor="video-search">
          Search for videos
        </label>
        <input
          id="video-search"
          className="input"
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          placeholder="Search a course, topic, or exam — e.g. thermodynamics past paper"
          style={{ flex: 1 }}
          maxLength={200}
        />
        <button
          type="submit"
          className="btn btn-primary"
          disabled={searching || searchDraft.trim().length < 2}
        >
          {searching ? "Searching…" : "Search"}
        </button>
        {searchResult && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setSearchResult(null);
              setSearchDraft("");
            }}
          >
            Clear
          </button>
        )}
      </form>
      <InlineError message={searchError} />

      {searchResult ? (
        <>
          <div className="eyebrow" style={{ marginBottom: 10 }}>
            Results for “{searchResult.query}”
            {searchResult.refinedQuery !== searchResult.query
              ? ` · searched as “${searchResult.refinedQuery}”`
              : ""}
          </div>
          {!searchResult.youtubeConfigured ? (
            <EmptyState
              icon={<SparklesIcon cls="icon-lg" />}
              title="Video search isn't configured yet"
              body="The server needs a YouTube API key before search works — the curated shelf below still does."
            />
          ) : searchResult.results.length === 0 ? (
            <EmptyState
              icon={<SparklesIcon cls="icon-lg" />}
              title="Nothing found"
              body="Try naming the subject and topic — e.g. “A-level chemistry electrolysis”."
            />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
              {searchResult.results.map((v) => (
                <YouTubeCard key={v.videoId} v={v} />
              ))}
            </div>
          )}
        </>
      ) : null}

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

      {/* Interest-mapped strips: queries built from YOUR subjects and weak
          topics, never generic. Only rendered with a configured key. */}
      {!searchResult &&
        showingFeed &&
        (suggestions.data?.suggestions.length ?? 0) > 0 && (
          <div style={{ marginBottom: 20 }}>
            {suggestions.data!.suggestions.map((group) => (
              <div key={group.reason} style={{ marginBottom: 14 }}>
                <div className="eyebrow" style={{ marginBottom: 8 }}>
                  From YouTube · {group.reason}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {group.videos.slice(0, 3).map((v) => (
                    <YouTubeCard key={v.videoId} v={v} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

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
