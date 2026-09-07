// Direct messages (PATHWISE 2.0 Phase 12): conversation list + thread in
// one screen. Message requests are explicit — nothing lands in your inbox
// without your say-so. Block/mute/report are one tap away.
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import { api, ApiError } from "../lib/api";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { MailIcon, SendIcon } from "../components/icons";
import {
  EmptyState,
  ErrorState,
  InlineError,
  SkeletonRows,
} from "../components/states";

interface ConversationRow {
  id: string;
  with: string;
  withId: string;
  status: string;
  incomingRequest: boolean;
  muted: boolean;
  unread: number;
  lastMessage: string | null;
  lastMessageAt: string;
}

interface ThreadResponse {
  conversation: {
    id: string;
    with: string;
    withId: string;
    status: string;
    incomingRequest: boolean;
    muted: boolean;
    messages: { id: string; mine: boolean; body: string; createdAt: string }[];
  };
}

function Thread({
  id,
  onChanged,
}: {
  id: string;
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data, loading, error: loadError, reload } = useApi<ThreadResponse>(
    `/api/dms/${id}`
  );

  async function send() {
    if (draft.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/dms/${id}/messages`, { body: draft });
      setDraft("");
      reload();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Send failed");
    } finally {
      setBusy(false);
    }
  }

  async function respond(action: "accept" | "decline") {
    setBusy(true);
    try {
      await api.post(`/api/dms/${id}/respond`, { action });
      if (action === "decline") {
        navigate("/messages");
      } else {
        reload();
      }
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function toggleMute() {
    if (!data) return;
    try {
      await api.post(`/api/dms/${id}/mute`, { on: !data.conversation.muted });
      reload();
    } catch {
      // Non-critical.
    }
  }

  async function block() {
    if (!data) return;
    if (!window.confirm(`Block ${data.conversation.with}? Neither of you will be able to message the other.`)) return;
    try {
      await api.post("/api/dms/block", { userId: data.conversation.withId, on: true });
      navigate("/messages");
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Block failed");
    }
  }

  async function report(messageId: string) {
    try {
      await api.post(`/api/dms/messages/${messageId}/report`, { reason: "other" });
      setError(null);
      window.alert("Reported — a human will review it.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Report failed");
    }
  }

  if (loading) return <SkeletonRows rows={4} height={48} />;
  if (loadError || !data) {
    return <ErrorState message={loadError ?? "Conversation not found"} onRetry={reload} />;
  }
  const c = data.conversation;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 15 }}>{c.with}</div>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn btn-ghost" style={{ fontSize: 11.5, padding: "4px 8px" }} onClick={toggleMute}>
            {c.muted ? "Unmute" : "Mute"}
          </button>
          <button
            className="btn btn-ghost"
            style={{ fontSize: 11.5, padding: "4px 8px", color: "var(--danger)" }}
            onClick={block}
          >
            Block
          </button>
        </div>
      </div>

      {c.incomingRequest && (
        <div className="form-notice" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <span>Message request — reply only if you want to.</span>
          <span style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary" style={{ fontSize: 12 }} disabled={busy} onClick={() => respond("accept")}>
              Accept
            </button>
            <button className="btn btn-ghost" style={{ fontSize: 12 }} disabled={busy} onClick={() => respond("decline")}>
              Decline
            </button>
          </span>
        </div>
      )}

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          maxHeight: 420,
          overflowY: "auto",
          padding: "4px 2px",
        }}
      >
        {c.messages.map((m) => (
          <div
            key={m.id}
            style={{
              alignSelf: m.mine ? "flex-end" : "flex-start",
              maxWidth: "80%",
            }}
          >
            <div
              className="card"
              style={{
                padding: "8px 12px",
                fontSize: 13.5,
                whiteSpace: "pre-wrap",
                background: m.mine ? "var(--accent-light, var(--surface))" : undefined,
              }}
            >
              {m.body}
            </div>
            {!m.mine && (
              <button
                className="btn btn-ghost"
                style={{ fontSize: 10.5, padding: "2px 6px", marginTop: 2 }}
                onClick={() => report(m.id)}
              >
                Report
              </button>
            )}
          </div>
        ))}
      </div>

      <InlineError message={error} />

      {(c.status === "active" || !c.incomingRequest) && (
        <div style={{ display: "flex", gap: 8 }}>
          <label className="sr-only" htmlFor="dm-draft">Message</label>
          <textarea
            id="dm-draft"
            className="input"
            rows={2}
            style={{ flex: 1 }}
            placeholder="Write a message…"
            value={draft}
            maxLength={3000}
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
      )}
    </div>
  );
}

export default function Messages() {
  const { user } = useAuth();
  const { conversationId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useApi<{ conversations: ConversationRow[] }>(
    user?.isGuest ? null : "/api/dms"
  );

  if (user?.isGuest) {
    return (
      <AppShell>
        <h1 className="page-title">Messages</h1>
        <EmptyState
          icon={<MailIcon cls="icon-lg" />}
          title="Messages need an account"
          body="Private conversations stay with your identity — create a free account to message other learners."
          action={
            <Link to="/signup" className="btn btn-primary">
              Create my account
            </Link>
          }
        />
      </AppShell>
    );
  }

  const rows = data?.conversations ?? [];

  return (
    <AppShell>
      <div className="page-head">
        <div>
          <h1 className="page-title">Messages</h1>
          <p className="page-sub">
            Talk to your study buddies. New people arrive as requests you can
            accept, decline, or block.
          </p>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: conversationId ? "minmax(180px, 260px) 1fr" : "1fr",
          gap: 16,
          alignItems: "start",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {loading ? (
            <SkeletonRows rows={4} height={56} />
          ) : error ? (
            <ErrorState message={error} onRetry={reload} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<MailIcon cls="icon-lg" />}
              title="No conversations yet"
              body="Find a study buddy first — messaging starts from a match."
              action={
                <Link to="/buddies" className="btn btn-primary">
                  Find study buddies
                </Link>
              }
            />
          ) : (
            rows.map((c) => (
              <button
                key={c.id}
                className="card"
                onClick={() => navigate(`/messages/${c.id}`)}
                style={{
                  padding: 12,
                  textAlign: "left",
                  cursor: "pointer",
                  border:
                    c.id === conversationId
                      ? "1px solid var(--accent)"
                      : undefined,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontWeight: 650, fontSize: 13.5 }}>
                    {c.with}
                    {c.muted ? " 🔕" : ""}
                  </span>
                  {c.unread > 0 && (
                    <span className="pill pill-coral" style={{ fontSize: 10.5 }}>
                      {c.unread}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 3 }}>
                  {c.incomingRequest ? "Message request" : c.lastMessage ?? "…"}
                </div>
              </button>
            ))
          )}
        </div>

        {conversationId && (
          <div className="card" style={{ padding: 16 }}>
            <Thread id={conversationId} onChanged={reload} />
          </div>
        )}
      </div>
    </AppShell>
  );
}
