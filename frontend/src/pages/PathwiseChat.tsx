// Chat with Pathwise (UX overhaul Phase 5): a dedicated AI chat straight
// from Home. Brutally honest, lightly Socratic. The + button attaches a
// PDF/DOCX/PPTX/photo — parsed server-side, then the conversation is about
// THAT document. History lives in sessionStorage so a refresh keeps it.
import { useEffect, useRef, useState } from "react";
import AppShell from "../components/AppShell";
import { api, ApiError } from "../lib/api";
import { PlusIcon, SendIcon, SparklesIcon } from "../components/icons";
import { InlineError, Spinner } from "../components/states";

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

interface Attachment {
  filename: string;
  text: string;
  chars: number;
  truncated: boolean;
}

const STORE_KEY = "pathwise_home_chat";

function loadStored(): { turns: ChatTurn[]; attachment: Attachment | null } {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // Fresh start on any storage weirdness.
  }
  return { turns: [], attachment: null };
}

export default function PathwiseChat() {
  const initial = loadStored();
  const [turns, setTurns] = useState<ChatTurn[]>(initial.turns);
  const [attachment, setAttachment] = useState<Attachment | null>(initial.attachment);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify({ turns, attachment }));
    } catch {
      // Storage full/blocked — the chat still works, it just won't survive refresh.
    }
  }, [turns, attachment]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length, busy]);

  async function attach(file: File | undefined) {
    if (!file) return;
    setAttaching(true);
    setError(null);
    try {
      const res = await api.upload<Attachment>("/api/chat/attach", file);
      setAttachment(res);
      setTurns((t) => [
        ...t,
        {
          role: "assistant",
          content: `Got it — ${res.filename} (${Math.round(res.chars / 1000)}k characters${res.truncated ? ", using the first part" : ""}). Ask me anything about it, or tell me what you're trying to learn.`,
        },
      ]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't read that file.");
    } finally {
      setAttaching(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function send() {
    const content = draft.trim();
    if (content.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    const next: ChatTurn[] = [...turns, { role: "user", content }];
    setTurns(next);
    setDraft("");
    try {
      const res = await api.post<{ reply: string }>("/api/chat", {
        // Send the last 20 turns — enough thread, bounded payload.
        messages: next.slice(-20),
        attachmentText: attachment?.text,
        attachmentName: attachment?.filename,
      });
      setTurns((t) => [...t, { role: "assistant", content: res.reply }]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Pathwise couldn't answer just now.");
      setDraft(content);
      setTurns(next.slice(0, -1));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    if (!window.confirm("Start a fresh chat? This clears the conversation and the attached file.")) return;
    setTurns([]);
    setAttachment(null);
    setError(null);
  }

  return (
    <AppShell>
      <div className="page-head">
        <div>
          <h1 className="page-title">Chat with Pathwise</h1>
          <p className="page-sub">
            An honest study companion — it will tell you straight what you
            haven't understood yet. Attach a document with + to talk about it.
          </p>
        </div>
        {(turns.length > 0 || attachment) && (
          <button className="btn btn-ghost btn-sm" onClick={reset}>
            New chat
          </button>
        )}
      </div>

      {attachment && (
        <div className="reply-bar" style={{ marginBottom: 10 }}>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            📄 <strong>{attachment.filename}</strong> attached
            {attachment.truncated ? " (long file — using the first part)" : ""}
          </span>
          <button
            className="icon-btn"
            style={{ width: 28, height: 28 }}
            onClick={() => setAttachment(null)}
            aria-label="Remove attachment"
          >
            ✕
          </button>
        </div>
      )}

      <div className="card" style={{ padding: 16 }}>
        <div className="dm-thread" ref={scrollRef} style={{ maxHeight: "min(62vh, 640px)" }}>
          {turns.length === 0 && (
            <div style={{ textAlign: "center", padding: "34px 12px", color: "var(--ink-soft)" }}>
              <SparklesIcon cls="icon-lg" style={{ margin: "0 auto 10px" }} />
              <p style={{ fontSize: 14, margin: 0 }}>
                Ask about anything you're studying — or attach your lecture
                notes and get grilled on them.
              </p>
            </div>
          )}
          {turns.map((t, i) => (
            <div key={i} className={`dm-row bubble-in ${t.role === "user" ? "mine" : "ai"}`}>
              <div className="dm-bubble">
                {t.role === "assistant" && (
                  <div className="dm-ai-tag">
                    <SparklesIcon cls="icon-sm" /> Pathwise
                  </div>
                )}
                {t.content}
              </div>
            </div>
          ))}
          {busy && (
            <div className="dm-row ai">
              <div className="dm-bubble" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Spinner size={14} /> thinking…
              </div>
            </div>
          )}
        </div>

        <InlineError message={error} />

        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button
            className="icon-btn"
            onClick={() => fileRef.current?.click()}
            disabled={attaching || busy}
            aria-label="Attach a document"
            title="Attach a PDF, DOCX, PPTX or photo"
          >
            {attaching ? <Spinner size={16} /> : <PlusIcon cls="icon" />}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.docx,.pptx,.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
            style={{ display: "none" }}
            onChange={(e) => attach(e.target.files?.[0])}
            aria-label="Attach a document to chat about"
          />
          <label className="sr-only" htmlFor="pw-chat-draft">Message Pathwise</label>
          <textarea
            id="pw-chat-draft"
            className="input"
            rows={2}
            style={{ flex: 1 }}
            placeholder={attachment ? `Ask about ${attachment.filename}…` : "Ask Pathwise anything…"}
            value={draft}
            maxLength={4000}
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
            aria-label="Send"
          >
            {busy ? <Spinner /> : <SendIcon cls="icon" />}
          </button>
        </div>
      </div>
    </AppShell>
  );
}
