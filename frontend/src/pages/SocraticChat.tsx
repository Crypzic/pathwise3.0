// Socratic Mode conversation (Step 7) — a real AI conversation.
//
// The answer-leak guard runs on the backend (lib/socraticGuard.ts): by the time
// a reply reaches this component it has already been inspected and, if needed,
// regenerated or replaced. There's no client-side filtering to bypass.
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  SparklesIcon,
  ArrowLeftIcon,
  ShieldIcon,
  SendIcon,
} from "../components/icons";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface SessionResponse {
  session: {
    id: string;
    courseId: string;
    courseName: string;
    topicId: string | null;
    topicName: string | null;
    status: string;
    turnCount: number;
  };
  messages: Message[];
}

export default function SocraticChat() {
  const navigate = useNavigate();
  const { sessionId } = useParams<{ sessionId: string }>();
  const { patchUser } = useAuth();

  const [session, setSession] = useState<SessionResponse["session"] | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sessionId) {
      navigate("/socratic", { replace: true });
      return;
    }
    api
      .get<SessionResponse>(`/api/socratic/sessions/${sessionId}`)
      .then((res) => {
        setSession(res.session);
        setMessages(res.messages);
      })
      .catch(() => navigate("/socratic", { replace: true }));
  }, [sessionId, navigate]);

  // Keep the newest turn in view as the conversation grows.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, thinking]);

  async function send() {
    const content = draft.trim();
    if (!content || !sessionId || thinking) return;

    setDraft("");
    setError(null);
    // Show the student's own message immediately — waiting on the round trip
    // makes the input feel broken.
    const optimistic: Message = {
      id: `local-${Date.now()}`,
      role: "user",
      content,
    };
    setMessages((prev) => [...prev, optimistic]);
    setThinking(true);

    try {
      const res = await api.post<{
        message: Message;
        turnCount: number;
        xp: { gained: number; total: number; rank: { level: number; name: string } };
      }>(`/api/socratic/sessions/${sessionId}/messages`, { content });

      setMessages((prev) => [...prev, res.message]);
      setSession((prev) => (prev ? { ...prev, turnCount: res.turnCount } : prev));
      patchUser({
        xp: res.xp.total,
        rank: {
          level: res.xp.rank.level,
          name: res.xp.rank.name,
          progress: 0,
          nextXp: null,
        },
      });
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Couldn't send that message."
      );
      // Roll the optimistic message back and hand the text back to the student.
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setDraft(content);
    } finally {
      setThinking(false);
    }
  }

  async function end() {
    if (!sessionId || ending) return;
    setEnding(true);
    try {
      await api.post(`/api/socratic/sessions/${sessionId}/end`);
    } catch {
      // Ending is best-effort; the student is leaving either way.
    }
    navigate(session ? `/progress/${session.courseId}` : "/courses");
  }

  return (
    <div className="socratic-shell">
      <div className="socratic-header">
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button
            onClick={end}
            disabled={ending}
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
            <ArrowLeftIcon cls="icon-sm" /> {ending ? "Saving…" : "Exit"}
          </button>
          <div className="thinking-label">
            <SparklesIcon cls="icon-sm" /> Thinking Together
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontSize: 12.5, color: "var(--soc-text-soft)" }}>
            {session?.topicName ?? session?.courseName ?? ""}
          </span>
          <span
            className="pill"
            style={{ background: "rgba(255,255,255,0.08)", color: "var(--soc-text-soft)" }}
          >
            <ShieldIcon cls="icon-sm" /> Integrity-safe
          </span>
        </div>
      </div>

      <div className="chat-area" aria-live="polite">
        {messages.map((msg) => (
          <div key={msg.id} className={`chat-msg ${msg.role === "assistant" ? "ai" : "user"}`}>
            {msg.role === "assistant" && <div className="tag">GUIDE</div>}
            {msg.content}
          </div>
        ))}

        {thinking && (
          <div className="chat-msg ai">
            <div className="tag">GUIDE</div>
            <span style={{ color: "var(--soc-text-soft)" }}>Thinking…</span>
          </div>
        )}

        {error && (
          <div
            role="alert"
            style={{
              alignSelf: "center",
              color: "#F6A8A8",
              fontSize: 12.5,
              background: "rgba(246,168,168,0.1)",
              padding: "8px 14px",
              borderRadius: 10,
            }}
          >
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <form
        className="chat-input-bar"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label className="sr-only" htmlFor="soc-input">
          Your reply
        </label>
        <input
          id="soc-input"
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Type your thinking — not looking for the answer…"
          disabled={thinking}
          autoFocus
        />
        <button
          type="submit"
          className="btn btn-primary"
          style={{ boxShadow: "none", background: "var(--soc-accent)" }}
          disabled={thinking || draft.trim().length === 0}
          aria-label="Send"
        >
          <SendIcon cls="icon-sm" />
        </button>
      </form>
    </div>
  );
}
