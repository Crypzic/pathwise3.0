// Videos (PATHWISE 2.0 Phases 14-15, rebuilt as a TikTok-style feed in the
// UX overhaul Phase 6): full-screen vertical slides, swipe/scroll to move,
// overlay actions. "For you" keeps the FYP ranking (mastery gaps, course
// topics, taste); categories filter the curated catalog; the search sheet
// covers AI-refined YouTube search. Full credit + source links always.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import { api, ApiError } from "../lib/api";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { PuzzleIcon, SparklesIcon } from "../components/icons";
import { InlineError, Spinner } from "../components/states";

interface YouTubeRow {
  videoId: string;
  title: string;
  channel: string;
  thumbnailUrl: string | null;
  url: string;
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
  action?: { topicId: string; courseId: string; topicName: string } | null;
}

function embedUrlOf(url: string): string | null {
  let e = url;
  if (e.includes("youtube.com/watch?v=")) {
    e = e.replace("youtube.com/watch?v=", "youtube.com/embed/");
    if (e.includes("&")) e = e.split("&")[0];
  } else if (e.includes("youtu.be/")) {
    e = e.replace("youtu.be/", "youtube.com/embed/");
    if (e.includes("?")) e = e.split("?")[0];
  } else {
    return null;
  }
  return `${e}?autoplay=1&rel=0&playsinline=1`;
}

/** One full-height slide. Only the active slide mounts its player. */
function Slide({
  v,
  active,
  isGuest,
  onEngage,
  onQuiz,
}: {
  v: VideoRow;
  active: boolean;
  isGuest: boolean;
  onEngage: (v: VideoRow, kind: "like" | "save") => void;
  onQuiz: (v: VideoRow) => void;
}) {
  const embed = embedUrlOf(v.url);
  return (
    <section className="feed-slide">
      <div className="feed-media">
        {active && embed ? (
          <iframe
            src={embed}
            title={v.title}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            style={{ border: 0, width: "100%", height: "100%" }}
          />
        ) : v.thumbnailUrl ? (
          <img src={v.thumbnailUrl} alt="" className="feed-thumb" />
        ) : (
          <div className="feed-thumb feed-thumb-empty">{v.subject}</div>
        )}
      </div>

      {/* Right action rail. */}
      <div className="feed-actions">
        {!isGuest && (
          <>
            <button
              className={`feed-action ${v.likedByMe ? "on" : ""}`}
              onClick={() => onEngage(v, "like")}
              aria-pressed={v.likedByMe}
              aria-label={v.likedByMe ? "Unlike" : "Like"}
            >
              <span aria-hidden="true">{v.likedByMe ? "❤️" : "🤍"}</span>
              <small>Like</small>
            </button>
            <button
              className={`feed-action ${v.savedByMe ? "on" : ""}`}
              onClick={() => onEngage(v, "save")}
              aria-pressed={v.savedByMe}
              aria-label={v.savedByMe ? "Unsave" : "Save"}
            >
              <span aria-hidden="true">🔖</span>
              <small>{v.savedByMe ? "Saved" : "Save"}</small>
            </button>
          </>
        )}
        {v.action && (
          <button
            className="feed-action"
            onClick={() => onQuiz(v)}
            aria-label={`Quiz yourself on ${v.action.topicName}`}
            title={`Quiz yourself on ${v.action.topicName}`}
          >
            <PuzzleIcon cls="icon" />
            <small>Quiz</small>
          </button>
        )}
        <a
          className="feed-action"
          href={v.url}
          target="_blank"
          rel="noreferrer noopener"
          aria-label="Watch at the source"
          title="Watch on YouTube"
        >
          <span aria-hidden="true">↗</span>
          <small>Source</small>
        </a>
      </div>

      {/* Bottom-left info overlay. */}
      <div className="feed-info">
        <div className="feed-title">{v.title}</div>
        <div className="feed-meta">
          {v.creator} · {v.subject}
        </div>
        {v.reason && <span className="pill pill-coral feed-reason">{v.reason}</span>}
      </div>
    </section>
  );
}

export default function Videos() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [subject, setSubject] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const shelf = useApi<{ videos: VideoRow[]; subjects: string[] }>(
    subject ? `/api/videos?subject=${encodeURIComponent(subject)}` : "/api/videos",
    [subject]
  );
  const fyp = useApi<{ feed: VideoRow[] }>("/api/fyp");

  const [searchDraft, setSearchDraft] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<{
    query: string;
    refinedQuery: string;
    results: YouTubeRow[];
    youtubeConfigured: boolean;
  } | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  const showingFeed = subject === null;
  const { loading, error, reload } = showingFeed ? fyp : shelf;
  const rows = showingFeed ? fyp.data?.feed ?? [] : shelf.data?.videos ?? [];

  // Track which slide fills the viewport; report a view when it changes.
  useEffect(() => {
    setActiveIndex(0);
    scrollRef.current?.scrollTo({ top: 0 });
  }, [subject]);

  useEffect(() => {
    const v = rows[activeIndex];
    if (v && !user?.isGuest) {
      void api.post(`/api/videos/${v.id}/engage`, { kind: "view" }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, rows[activeIndex]?.id]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el || el.clientHeight === 0) return;
    const idx = Math.round(el.scrollTop / el.clientHeight);
    if (idx !== activeIndex) setActiveIndex(idx);
  }

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

  const subjects = shelf.data?.subjects ?? [];

  return (
    <AppShell>
      <div className="feed-shell">
        {/* Top overlay: category label + search trigger. */}
        <div className="feed-top">
          <span className="feed-top-label">
            {subject ?? "For you"}
          </span>
          <button
            className="icon-btn feed-top-btn"
            onClick={() => setSheetOpen(true)}
            aria-label="Search and categories"
            title="Search and categories"
          >
            🔍
          </button>
        </div>

        {loading ? (
          <div className="feed-center">
            <Spinner size={22} /> Loading your feed…
          </div>
        ) : error ? (
          <div className="feed-center">
            <p>{error}</p>
            <button className="btn btn-ghost btn-sm" onClick={reload}>
              Try again
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div className="feed-center">
            <SparklesIcon cls="icon-lg" />
            <p>
              {subject
                ? "Nothing in this category yet — try another."
                : "Your feed fills in as the catalog grows and you study more."}
            </p>
          </div>
        ) : (
          <div className="feed-scroll" ref={scrollRef} onScroll={onScroll}>
            {rows.map((v, i) => (
              <Slide
                key={v.id}
                v={v}
                active={i === activeIndex}
                isGuest={Boolean(user?.isGuest)}
                onEngage={engage}
                onQuiz={quizFrom}
              />
            ))}
          </div>
        )}

        {actionError && (
          <div className="feed-error">
            <InlineError message={actionError} />
          </div>
        )}

        {/* Search + categories sheet. */}
        {sheetOpen && (
          <>
            <div className="feed-sheet-backdrop" onClick={() => setSheetOpen(false)} />
            <div className="feed-sheet" role="dialog" aria-label="Search and categories">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <h2 style={{ fontSize: 15.5 }}>Find something to watch</h2>
                <button
                  className="icon-btn"
                  onClick={() => setSheetOpen(false)}
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={runSearch} role="search" className="toolbar" style={{ marginBottom: 12 }}>
                <label className="sr-only" htmlFor="video-search">Search for videos</label>
                <input
                  id="video-search"
                  className="input"
                  value={searchDraft}
                  onChange={(e) => setSearchDraft(e.target.value)}
                  placeholder="e.g. thermodynamics past paper walkthrough"
                  maxLength={200}
                />
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={searching || searchDraft.trim().length < 2}
                >
                  {searching ? <Spinner /> : "Search"}
                </button>
              </form>
              <InlineError message={searchError} />

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
                <button
                  className={subject === null ? "pill pill-coral" : "pill pill-muted"}
                  style={{ cursor: "pointer", border: "none" }}
                  onClick={() => {
                    setSubject(null);
                    setSheetOpen(false);
                    setSearchResult(null);
                  }}
                >
                  For you
                </button>
                {subjects.map((s) => (
                  <button
                    key={s}
                    className={subject === s ? "pill pill-coral" : "pill pill-muted"}
                    style={{ cursor: "pointer", border: "none" }}
                    onClick={() => {
                      setSubject(s);
                      setSheetOpen(false);
                      setSearchResult(null);
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>

              {searchResult && (
                <>
                  <div className="eyebrow" style={{ marginBottom: 8 }}>
                    Results for “{searchResult.query}”
                    {searchResult.refinedQuery !== searchResult.query
                      ? ` · searched as “${searchResult.refinedQuery}”`
                      : ""}
                  </div>
                  {!searchResult.youtubeConfigured ? (
                    <p style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                      Video search needs the server's YouTube key — the feed
                      and categories still work.
                    </p>
                  ) : searchResult.results.length === 0 ? (
                    <p style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                      Nothing found — try naming the subject and topic.
                    </p>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {searchResult.results.map((v) => (
                        <a
                          key={v.videoId}
                          href={v.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="member-row"
                          style={{ textDecoration: "none" }}
                        >
                          {v.thumbnailUrl ? (
                            <img src={v.thumbnailUrl} alt="" style={{ width: 92, borderRadius: 8, flexShrink: 0 }} />
                          ) : null}
                          <span style={{ minWidth: 0 }}>
                            <span style={{ display: "block", fontWeight: 650, fontSize: 13, lineHeight: 1.35 }}>
                              {v.title}
                            </span>
                            <span style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>
                              {v.channel} · YouTube
                            </span>
                          </span>
                        </a>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
