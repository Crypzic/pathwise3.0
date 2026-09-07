// Study Buddy Room (PATHWISE 2.0 Phases 11/19): chat with your buddy
// around a focus topic. PATHWISE facilitates only when BOTH of you ask —
// and even then it asks questions rather than handing over answers.
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import { api, ApiError } from "../lib/api";
import { useApi } from "../lib/useApi";
import { SendIcon, SparklesIcon } from "../components/icons";
import {
  ErrorState,
  InlineError,
  InlineNotice,
  SkeletonRows,
} from "../components/states";

interface RoomMessage {
  id: string;
  role: "user" | "assistant";
  mine: boolean;
  content: string;
  createdAt: string;
}

interface RoomResponse {
  room: {
    id: string;
    with: string;
    withId: string;
    topicName: string | null;
    status: string;
    myHelpPending: boolean;
    partnerWantsHelp: boolean;
    messages: RoomMessage[];
  };
}

export default function StudyRoom() {
  const { roomId } = useParams<{ roomId: string }>();
  const [draft, setDraft] = useState("");
  const [topicDraft, setTopicDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data, loading, error: loadError, reload } = useApi<RoomResponse>(
    roomId ? `/api/rooms/${roomId}` : null
  );

  // Poll lightly so a buddy's messages appear without a manual refresh.
  useEffect(() => {
    const timer = window.setInterval(reload, 8000);
    return () => window.clearInterval(timer);
  }, [reload]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [data?.room.messages.length]);

  async function send() {
    if (!roomId || draft.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/rooms/${roomId}/messages`, { content: draft });
      setDraft("");
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Send failed");
    } finally {
      setBusy(false);
    }
  }

  async function setTopic() {
    if (!roomId || topicDraft.trim().length < 2) return;
    try {
      await api.post(`/api/rooms/${roomId}/topic`, { topicName: topicDraft });
      setTopicDraft("");
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't set the topic");
    }
  }

  async function askForHelp() {
    if (!roomId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.post<{ facilitated: boolean; message?: unknown }>(
        `/api/rooms/${roomId}/help`,
        {}
      );
      if (!res.facilitated) {
        setNotice("Help requested — PATHWISE joins when your buddy asks too.");
      }
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Help request failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) {
    return (
      <AppShell>
        <SkeletonRows rows={4} height={60} />
      </AppShell>
    );
  }
  if (loadError || !data) {
    return (
      <AppShell>
        <ErrorState message={loadError ?? "Room not found"} onRetry={reload} />
      </AppShell>
    );
  }

  const { room } = data;

  return (
    <AppShell>
      <Link to="/buddies" style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>
        ← Study buddies
      </Link>
      <div className="page-head" style={{ marginTop: 4, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h1 className="page-title">Room with {room.with}</h1>
          <p className="page-sub">
            {room.topicName
              ? `Focus: ${room.topicName}`
              : "No focus topic yet — set one below."}
            {room.partnerWantsHelp ? " · Your buddy asked PATHWISE for help." : ""}
          </p>
        </div>
        <button
          className={room.myHelpPending ? "btn btn-ghost" : "btn btn-primary"}
          onClick={askForHelp}
          disabled={busy}
          title="PATHWISE steps in when you both ask"
        >
          <SparklesIcon cls="icon" />{" "}
          {room.myHelpPending ? "Help requested…" : "Ask PATHWISE together"}
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <label className="sr-only" htmlFor="room-topic">Focus topic</label>
        <input
          id="room-topic"
          className="input"
          style={{ maxWidth: 280 }}
          placeholder={room.topicName ? `Change topic (now: ${room.topicName})` : "Set a focus topic…"}
          value={topicDraft}
          maxLength={80}
          onChange={(e) => setTopicDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void setTopic();
          }}
        />
        <button className="btn btn-ghost" onClick={setTopic} disabled={topicDraft.trim().length < 2}>
          Set topic
        </button>
      </div>

      <InlineNotice message={notice} />
      <InlineError message={error} />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          maxHeight: 440,
          overflowY: "auto",
          padding: "4px 2px",
          marginBottom: 12,
        }}
      >
        {room.messages.length === 0 && (
          <p style={{ fontSize: 13, color: "var(--ink-soft)", textAlign: "center", padding: 20 }}>
            Say hi — then try explaining the topic to each other. Teaching is
            the fastest way to find the gaps.
          </p>
        )}
        {room.messages.map((m) => (
          <div
            key={m.id}
            style={{
              alignSelf:
                m.role === "assistant" ? "center" : m.mine ? "flex-end" : "flex-start",
              maxWidth: m.role === "assistant" ? "92%" : "80%",
            }}
          >
            <div
              className="card"
              style={{
                padding: "8px 12px",
                fontSize: 13.5,
                whiteSpace: "pre-wrap",
                ...(m.role === "assistant"
                  ? { borderColor: "var(--accent)", background: "var(--accent-light, var(--surface))" }
                  : {}),
              }}
            >
              {m.role === "assistant" && (
                <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--accent)", marginBottom: 3 }}>
                  PATHWISE
                </div>
              )}
              {m.content}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <label className="sr-only" htmlFor="room-draft">Message</label>
        <textarea
          id="room-draft"
          className="input"
          rows={2}
          style={{ flex: 1 }}
          placeholder="Work it out together…"
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
          aria-label="Send"
        >
          <SendIcon cls="icon" />
        </button>
      </div>
    </AppShell>
  );
}
