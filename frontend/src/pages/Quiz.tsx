// Quiz Mode (Step 5) — real questions, server-side grading, live mastery move.
//
// The correct answer isn't in the payload until after the student answers, so
// it can't be read out of the network tab. Time-on-question is measured here
// and sent along: it feeds the "guessing vs understanding" signal.
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useRewardToasts } from "../lib/toast";
import {
  FlameIcon,
  CheckIcon,
  AlertIcon,
  TrendingUpIcon,
  SparklesIcon,
} from "../components/icons";
import { ErrorState, InlineError, Loading } from "../components/states";

interface QuizItem {
  id: string;
  position: number;
  number: number;
  total: number;
  kind: "mcq" | "written";
  topicName: string;
  question: string;
  options: string[];
}

interface Flashcard {
  id: string;
  topicName: string;
  front: string;
  back: string;
  explanation: string;
  gotIt: boolean;
}

interface SessionState {
  session: {
    id: string;
    kind: string;
    status: string;
    courseId: string;
    courseName: string;
    total: number;
    answeredCount: number;
    correctCount: number;
  };
  progress: { position: number; answered: boolean; isCorrect: boolean | null }[];
  current: QuizItem | null;
}

interface AnswerResponse {
  result: {
    kind: "mcq" | "written";
    isCorrect: boolean;
    correctIndex: number | null;
    explanation: string;
    selectedIndex: number | null;
    verdict: "correct" | "close" | "incorrect" | null;
    referenceAnswer: string | null;
  };
  mastery: { before: number; after: number } | null;
  xp: {
    gained: number;
    total: number;
    rank: { level: number; name: string };
    rankedUp: boolean;
  };
  streak: { count: number; best: number };
  newBadges: { key: string; name: string; description: string }[];
  remaining: number;
  completion: {
    correctCount: number;
    total: number;
    xpBonus: number;
    perfect: boolean;
  } | null;
}

export default function Quiz() {
  const navigate = useNavigate();
  const { sessionId } = useParams<{ sessionId: string }>();
  const { patchUser } = useAuth();
  const showRewards = useRewardToasts();

  const [state, setState] = useState<SessionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<AnswerResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sessionXp, setSessionXp] = useState(0);
  const [runStreak, setRunStreak] = useState(0);
  const [writtenDraft, setWrittenDraft] = useState("");
  // Flashcard review after completion.
  const [cards, setCards] = useState<Flashcard[] | null>(null);
  const [cardIndex, setCardIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  // Set when a question is rendered; read when it's answered.
  const shownAt = useRef<number>(Date.now());

  async function load(id: string) {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.get<SessionState>(`/api/quiz/sessions/${id}`);
      setState(res);
      setAnswer(null);
      shownAt.current = Date.now();
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Couldn't load that quiz."
      );
    } finally {
      setLoading(false);
    }
  }

  // No session id in the URL: resume an active quiz, else send them to pick a
  // course. Starting one blind isn't possible — a quiz needs a course.
  useEffect(() => {
    if (sessionId) {
      void load(sessionId);
      return;
    }
    setLoading(true);
    api
      .get<{ session: { id: string } | null }>("/api/quiz/active")
      .then((res) => {
        if (res.session) navigate(`/quiz/${res.session.id}`, { replace: true });
        else navigate("/courses", { replace: true });
      })
      .catch(() => navigate("/courses", { replace: true }));
  }, [sessionId, navigate]);

  async function submit(payload: { selectedIndex?: number; answerText?: string }) {
    if (!sessionId || !state?.current || answer || submitting) return;
    setSubmitting(true);
    setActionError(null);

    const timeMs = Math.min(Date.now() - shownAt.current, 30 * 60 * 1000);

    try {
      const res = await api.post<AnswerResponse>(
        `/api/quiz/sessions/${sessionId}/answer`,
        { ...payload, timeMs }
      );
      setAnswer(res);
      setSessionXp((x) => x + res.xp.gained + (res.completion?.xpBonus ?? 0));
      setRunStreak((s) => (res.result.isCorrect ? s + 1 : 0));

      // Keep the rail's XP chip and streak honest without a refetch.
      patchUser({
        xp: res.xp.total,
        rank: {
          level: res.xp.rank.level,
          name: res.xp.rank.name,
          progress: 0,
          nextXp: null,
        },
        streakCount: res.streak.count,
        bestStreak: res.streak.best,
      });
      showRewards(res);
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Couldn't submit that answer."
      );
    } finally {
      setSubmitting(false);
    }
  }

  function next() {
    if (!sessionId) return;
    if (answer?.completion) {
      navigate(`/progress/${state?.session.courseId ?? ""}`);
      return;
    }
    setWrittenDraft("");
    void load(sessionId);
  }

  // Flashcards (post-quiz reinforcement): the quiz's own Q&A as a deck.
  async function startFlashcards() {
    if (!sessionId) return;
    try {
      const res = await api.get<{ cards: Flashcard[] }>(
        `/api/quiz/sessions/${sessionId}/review`
      );
      setCards(res.cards);
      setCardIndex(0);
      setFlipped(false);
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Couldn't load flashcards."
      );
    }
  }

  if (loading) {
    return (
      <AppShell>
        <Loading label="Building your quiz…" />
      </AppShell>
    );
  }

  if (loadError || !state) {
    return (
      <AppShell>
        <ErrorState
          message={loadError ?? "Quiz not found."}
          onRetry={() => sessionId && load(sessionId)}
        />
      </AppShell>
    );
  }

  // Flashcard review mode (post-quiz): the quiz's own Q&A as a flip deck,
  // so what was just practiced gets one more retrieval pass. Checked before
  // the resume screen so "Review as flashcards" works from there too.
  if (cards) {
    const card = cards[cardIndex];
    const last = cardIndex >= cards.length - 1;
    return (
      <AppShell>
        <div className="eyebrow" style={{ marginBottom: 12 }}>
          Flashcards · {cardIndex + 1} of {cards.length} · {card.topicName}
        </div>
        <button
          className="card"
          onClick={() => setFlipped((f) => !f)}
          aria-label={flipped ? "Show question" : "Reveal answer"}
          style={{
            width: "100%",
            minHeight: 220,
            padding: 24,
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            cursor: "pointer",
            border: flipped ? "1px solid var(--accent)" : undefined,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-faint)", letterSpacing: 1 }}>
            {flipped ? "ANSWER" : "QUESTION — tap to reveal"}
          </div>
          <div style={{ fontSize: 16, lineHeight: 1.5, fontWeight: flipped ? 700 : 500 }}>
            {flipped ? card.back : card.front}
          </div>
          {flipped && card.explanation && (
            <div style={{ fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.55 }}>
              {card.explanation}
            </div>
          )}
        </button>
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button
            className="btn btn-ghost"
            style={{ flex: 1 }}
            disabled={cardIndex === 0}
            onClick={() => {
              setCardIndex((i) => Math.max(0, i - 1));
              setFlipped(false);
            }}
          >
            Back
          </button>
          <button
            className="btn btn-primary"
            style={{ flex: 2 }}
            onClick={() => {
              if (last) {
                navigate(`/progress/${state.session.courseId}`);
              } else {
                setCardIndex((i) => i + 1);
                setFlipped(false);
              }
            }}
          >
            {last ? "Done — see your progress" : flipped ? "Next card" : "Skip"}
          </button>
        </div>
      </AppShell>
    );
  }

  // Finished, and the student came back to the URL.
  if (!state.current && !answer) {
    return (
      <AppShell>
        <div className="empty-state">
          <div className="icon-circle">
            <CheckIcon cls="icon-lg" />
          </div>
          <h2 style={{ fontSize: 17, marginBottom: 6 }}>Quiz complete</h2>
          <p style={{ color: "var(--ink-soft)", fontSize: 13.5, marginBottom: 18 }}>
            You got {state.session.correctCount} of {state.session.total} right.
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <button className="btn btn-ghost" onClick={startFlashcards}>
              🃏 Review as flashcards
            </button>
            <button
              className="btn btn-primary"
              onClick={() => navigate(`/progress/${state.session.courseId}`)}
            >
              See your progress
            </button>
          </div>
        </div>
      </AppShell>
    );
  }

  const q = state.current;
  const completion = answer?.completion;

  return (
    <AppShell>
      <div className="topbar">
        <div className="dots-row" role="img" aria-label={`Question ${q ? q.number : state.session.total} of ${state.session.total}`}>
          {state.progress.map((p) => (
            <div
              key={p.position}
              className={`dot ${p.answered ? "filled" : ""} ${
                q && p.position === q.position ? "current" : ""
              }`}
            />
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {runStreak >= 2 && (
            <span className="streak-badge" style={{ color: "var(--accent)" }}>
              <FlameIcon cls="icon-sm" /> {runStreak} in a row
            </span>
          )}
          <span className="xp-chip">{sessionXp} XP</span>
        </div>
      </div>

      <InlineError message={actionError} />

      {q && (
        <>
          <div className="eyebrow">
            {q.topicName} · Question {q.number} of {q.total}
            {q.kind === "written" ? " · Write your answer" : ""}
          </div>
          <h1 style={{ fontSize: 20, lineHeight: 1.4, marginBottom: 24 }}>
            {q.question}
          </h1>

          {q.kind === "written" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 22 }}>
              <label className="sr-only" htmlFor="written-answer">Your answer</label>
              <textarea
                id="written-answer"
                className="input"
                rows={4}
                placeholder="Answer in your own words — 1-3 sentences is plenty."
                value={writtenDraft}
                maxLength={3000}
                onChange={(e) => setWrittenDraft(e.target.value)}
                disabled={answer !== null || submitting}
              />
              {!answer && (
                <button
                  className="btn btn-primary"
                  onClick={() => submit({ answerText: writtenDraft })}
                  disabled={submitting || writtenDraft.trim().length === 0}
                >
                  {submitting ? "Grading…" : "Submit answer"}
                </button>
              )}
            </div>
          ) : (
            <div
              role="group"
              aria-label="Answer options"
              style={{ display: "flex", flexDirection: "column", gap: 11, marginBottom: 22 }}
            >
              {q.options.map((opt, i) => {
                const answered = answer !== null;
                const isRight = answered && i === answer.result.correctIndex;
                const isWrongPick =
                  answered && i === answer.result.selectedIndex && !answer.result.isCorrect;

                return (
                  <button
                    key={`${q.id}-${i}`}
                    className={`quiz-option ${isRight ? "correct" : ""} ${isWrongPick ? "wrong" : ""}`}
                    onClick={() => submit({ selectedIndex: i })}
                    disabled={answered || submitting}
                    aria-pressed={answered && i === answer.result.selectedIndex}
                  >
                    <span className="marker" aria-hidden="true">
                      {isRight && <CheckIcon cls="icon-sm" />}
                      {isWrongPick && <AlertIcon cls="icon-sm" />}
                    </span>
                    <span style={{ fontWeight: isRight ? 700 : 400 }}>{opt}</span>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      {answer && (
        <>
          <div
            className="card"
            role="status"
            style={{
              background:
                answer.result.verdict === "close"
                  ? "var(--warning-light)"
                  : answer.result.isCorrect
                    ? "var(--success-light)"
                    : "var(--warning-light)",
              border: "none",
              marginBottom: 16,
            }}
          >
            <div
              style={{
                fontWeight: 700,
                color: answer.result.isCorrect ? "var(--primary-dark)" : "#8A6412",
                marginBottom: 3,
                fontSize: 14,
              }}
            >
              {answer.result.kind === "written"
                ? answer.result.verdict === "correct"
                  ? "Spot on"
                  : answer.result.verdict === "close"
                    ? "Close — almost there"
                    : "Not quite"
                : answer.result.isCorrect
                  ? "That's correct"
                  : "Not quite"}
            </div>
            <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
              {answer.result.explanation}
            </div>
            {answer.result.kind === "written" && answer.result.referenceAnswer && (
              <div
                style={{
                  marginTop: 10,
                  paddingTop: 10,
                  borderTop: "1px solid rgba(0,0,0,0.08)",
                  fontSize: 13,
                }}
              >
                <strong style={{ fontSize: 12 }}>Model answer:</strong>{" "}
                {answer.result.referenceAnswer}
              </div>
            )}
          </div>

          {answer.mastery && answer.mastery.after !== answer.mastery.before && (
            <div
              className="card"
              style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}
            >
              <TrendingUpIcon
                cls="icon"
                style={{
                  color:
                    answer.mastery.after > answer.mastery.before
                      ? "var(--success)"
                      : "var(--danger)",
                }}
              />
              <div style={{ fontSize: 13 }}>
                Mastery {answer.mastery.before}% → <strong>{answer.mastery.after}%</strong>
              </div>
              <span className="xp-chip" style={{ marginLeft: "auto" }}>
                +{answer.xp.gained} XP
              </span>
            </div>
          )}

          {completion && (
            <div
              className="card"
              style={{ marginBottom: 16, textAlign: "center", background: "var(--primary-light)", border: "none" }}
            >
              <SparklesIcon
                cls="icon-lg"
                style={{ margin: "0 auto 8px auto", color: "var(--primary-dark)" }}
              />
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>
                {completion.perfect ? "Perfect quiz!" : "Quiz complete"}
              </div>
              <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                {completion.correctCount} of {completion.total} correct · +
                {completion.xpBonus} bonus XP
              </div>
              <button
                className="btn btn-ghost"
                style={{ marginTop: 12 }}
                onClick={startFlashcards}
              >
                🃏 Lock it in with flashcards
              </button>
            </div>
          )}

          <button className="btn btn-primary btn-block" onClick={next} autoFocus>
            {completion ? "See your progress" : "Next question"}
          </button>
        </>
      )}
    </AppShell>
  );
}
