// The learning layer (Ask PATHWISE phase): a lecturer-grade breakdown of
// one topic, generated from the course's own material, with an in-page
// tutor that MAY explain directly — this is the teaching surface. The flow:
// read the breakdown → ask what's unclear → quiz yourself with confidence.
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import { api, ApiError } from "../lib/api";
import { useApi } from "../lib/useApi";
import { PuzzleIcon, SendIcon, SparklesIcon } from "../components/icons";
import { ErrorState, InlineError, Loading } from "../components/states";

interface BreakdownSection {
  heading: string;
  body: string;
  example?: string;
}

interface BreakdownResponse {
  breakdown: {
    overview: string;
    sections: BreakdownSection[];
    misconceptions: { myth: string; truth: string }[];
    summary: string;
  };
  cached: boolean;
  topicName: string;
  courseId: string;
  courseName: string;
}

interface AskMessage {
  role: "user" | "assistant";
  content: string;
}

function AskPanel({ topicId, topicName }: { topicId: string; topicName: string }) {
  const [messages, setMessages] = useState<AskMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    const content = draft.trim();
    if (content.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    const next = [...messages, { role: "user" as const, content }];
    setMessages(next);
    setDraft("");
    try {
      const res = await api.post<{ reply: string }>(`/api/topics/${topicId}/ask`, {
        // Only the recent window travels — long chats get expensive.
        messages: next.slice(-10),
      });
      setMessages([...next, { role: "assistant", content: res.reply }]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't get an answer.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ padding: 16, marginTop: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <SparklesIcon cls="icon" style={{ color: "var(--accent)" }} />
        <div style={{ fontWeight: 700, fontSize: 14 }}>Ask PATHWISE</div>
      </div>
      <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 12 }}>
        Anything unclear in {topicName}? Ask here — unlike the Socratic tutor,
        I'll explain directly.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              alignSelf: m.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "88%",
            }}
          >
            <div
              className="card"
              style={{
                padding: "8px 12px",
                fontSize: 13.5,
                whiteSpace: "pre-wrap",
                ...(m.role === "assistant"
                  ? { borderColor: "var(--accent)" }
                  : { background: "var(--accent-light, var(--surface))" }),
              }}
            >
              {m.content}
            </div>
          </div>
        ))}
        {busy && (
          <div style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>Thinking…</div>
        )}
      </div>

      <InlineError message={error} />

      <div style={{ display: "flex", gap: 8 }}>
        <label className="sr-only" htmlFor="ask-draft">Your question</label>
        <textarea
          id="ask-draft"
          className="input"
          rows={2}
          style={{ flex: 1 }}
          placeholder="e.g. I don't get the part about…"
          value={draft}
          maxLength={2000}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button
          className="btn btn-primary"
          onClick={send}
          disabled={busy || draft.trim().length === 0}
          aria-label="Send question"
        >
          <SendIcon cls="icon" />
        </button>
      </div>
    </div>
  );
}

export default function TopicView() {
  const { topicId } = useParams<{ topicId: string }>();
  const navigate = useNavigate();
  const [quizError, setQuizError] = useState<string | null>(null);

  const { data, loading, error, reload } = useApi<BreakdownResponse>(
    topicId ? `/api/topics/${topicId}/breakdown` : null
  );

  async function startQuiz() {
    if (!data || !topicId) return;
    setQuizError(null);
    try {
      const res = await api.post<{ sessionId: string }>("/api/quiz/sessions", {
        courseId: data.courseId,
        kind: "practice",
        topicId,
      });
      navigate(`/quiz/${res.sessionId}`);
    } catch (err) {
      setQuizError(err instanceof ApiError ? err.message : "Couldn't start a quiz.");
    }
  }

  if (loading) {
    return (
      <AppShell>
        <Loading label="Preparing your breakdown — the first visit takes a moment while it's written for you…" />
      </AppShell>
    );
  }
  if (error || !data) {
    return (
      <AppShell>
        <ErrorState message={error ?? "Topic not found"} onRetry={reload} />
      </AppShell>
    );
  }

  const { breakdown } = data;

  return (
    <AppShell>
      <Link
        to={`/courses/${data.courseId}`}
        style={{ fontSize: 12.5, color: "var(--ink-soft)" }}
      >
        ← {data.courseName}
      </Link>

      <div className="page-head" style={{ marginTop: 4, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h1 className="page-title">{data.topicName}</h1>
          <p className="page-sub">{breakdown.overview}</p>
        </div>
        <button className="btn btn-primary" onClick={startQuiz} style={{ flexShrink: 0 }}>
          <PuzzleIcon cls="icon" /> Quiz me on this
        </button>
      </div>

      <InlineError message={quizError} />

      <article style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {breakdown.sections.map((s, i) => (
          <section key={i} className="card" style={{ padding: 18 }}>
            <h2 style={{ fontSize: 15.5, fontWeight: 700, marginBottom: 8 }}>
              {s.heading}
            </h2>
            <p style={{ fontSize: 14, lineHeight: 1.65, whiteSpace: "pre-wrap" }}>
              {s.body}
            </p>
            {s.example && (
              <div
                style={{
                  marginTop: 12,
                  padding: "10px 14px",
                  borderLeft: "3px solid var(--accent)",
                  background: "var(--accent-light, var(--surface))",
                  borderRadius: 8,
                  fontSize: 13.5,
                  lineHeight: 1.6,
                  whiteSpace: "pre-wrap",
                }}
              >
                <strong style={{ fontSize: 12, display: "block", marginBottom: 4 }}>
                  Worked example
                </strong>
                {s.example}
              </div>
            )}
          </section>
        ))}

        {breakdown.misconceptions.length > 0 && (
          <section className="card" style={{ padding: 18 }}>
            <h2 style={{ fontSize: 15.5, fontWeight: 700, marginBottom: 10 }}>
              Watch out for these
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {breakdown.misconceptions.map((m, i) => (
                <div key={i} style={{ fontSize: 13.5, lineHeight: 1.6 }}>
                  <div style={{ color: "var(--danger)", fontWeight: 650 }}>
                    ✗ {m.myth}
                  </div>
                  <div style={{ color: "var(--success)", marginTop: 2 }}>
                    ✓ {m.truth}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {breakdown.summary && (
          <section
            className="card"
            style={{
              padding: 18,
              background: "var(--primary-light)",
              border: "none",
            }}
          >
            <h2 style={{ fontSize: 15.5, fontWeight: 700, marginBottom: 8 }}>
              Before your exam, remember
            </h2>
            <p style={{ fontSize: 14, lineHeight: 1.65 }}>{breakdown.summary}</p>
          </section>
        )}
      </article>

      {topicId && <AskPanel topicId={topicId} topicName={data.topicName} />}

      <div style={{ marginTop: 20, textAlign: "center" }}>
        <button className="btn btn-primary" onClick={startQuiz}>
          <PuzzleIcon cls="icon" /> Feeling ready? Quiz yourself
        </button>
      </div>
    </AppShell>
  );
}
