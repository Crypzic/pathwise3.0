// One community post (PATHWISE 2.0 Phase 9): thread view with replies,
// "helpful" reactions, reporting, and author takedown.
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import { api, ApiError } from "../lib/api";
import { useApi } from "../lib/useApi";
import {
  ErrorState,
  InlineError,
  SkeletonRows,
} from "../components/states";

interface ReplyRow {
  id: string;
  body: string;
  author: string;
  mine: boolean;
  helpful: number;
  reactedByMe: boolean;
  createdAt: string;
}

interface PostResponse {
  post: {
    id: string;
    kind: string;
    title: string;
    body: string;
    author: string;
    mine: boolean;
    helpful: number;
    reactedByMe: boolean;
    createdAt: string;
    community: { id: string; name: string; slug: string };
    canReply: boolean;
    replies: ReplyRow[];
  };
}

const REPORT_REASONS = [
  ["spam", "Spam"],
  ["harassment", "Harassment"],
  ["unsafe", "Unsafe content"],
  ["off_topic", "Off topic"],
  ["other", "Other"],
] as const;

function ReportButton({
  targetType,
  targetId,
}: {
  targetType: "post" | "reply";
  targetId: string;
}) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(reason: string) {
    setError(null);
    try {
      await api.post("/api/communities/reports", { targetType, targetId, reason });
      setDone(true);
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Report failed");
    }
  }

  if (done) {
    return <span style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>Reported ✓</span>;
  }
  return (
    <span style={{ position: "relative" }}>
      <button
        className="btn btn-ghost"
        style={{ fontSize: 11.5, padding: "4px 8px" }}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        Report
      </button>
      {open && (
        <span
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            zIndex: 10,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: 6,
            display: "flex",
            flexDirection: "column",
            gap: 2,
            minWidth: 150,
            boxShadow: "var(--shadow-lg, 0 8px 24px rgba(0,0,0,0.12))",
          }}
        >
          {REPORT_REASONS.map(([value, label]) => (
            <button
              key={value}
              className="btn btn-ghost"
              style={{ fontSize: 12, justifyContent: "flex-start", padding: "6px 8px" }}
              onClick={() => send(value)}
            >
              {label}
            </button>
          ))}
          {error && <span style={{ fontSize: 11, color: "var(--danger)" }}>{error}</span>}
        </span>
      )}
    </span>
  );
}

function HelpfulButton({
  count,
  active,
  onToggle,
}: {
  count: number;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      className={active ? "pill pill-coral" : "pill pill-muted"}
      onClick={onToggle}
      style={{ cursor: "pointer", border: "none", fontSize: 11.5 }}
      aria-pressed={active}
    >
      👍 Helpful{count > 0 ? ` · ${count}` : ""}
    </button>
  );
}

export default function PostView() {
  const { postId } = useParams<{ postId: string }>();
  const navigate = useNavigate();
  const [replyBody, setReplyBody] = useState("");
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, loading, error, reload } = useApi<PostResponse>(
    postId ? `/api/communities/posts/${postId}` : null
  );

  async function reactPost() {
    if (!postId) return;
    try {
      await api.post(`/api/communities/posts/${postId}/react`, {});
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Reaction failed");
    }
  }

  async function reactReply(replyId: string) {
    try {
      await api.post(`/api/communities/replies/${replyId}/react`, {});
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Reaction failed");
    }
  }

  async function sendReply() {
    if (!postId) return;
    setSending(true);
    setActionError(null);
    try {
      await api.post(`/api/communities/posts/${postId}/replies`, { body: replyBody });
      setReplyBody("");
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Reply failed");
    } finally {
      setSending(false);
    }
  }

  async function removePost() {
    if (!postId || !data) return;
    if (!window.confirm("Remove this post? This can't be undone.")) return;
    try {
      await api.del(`/api/communities/posts/${postId}`);
      navigate(`/communities/${data.post.community.id}`);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Removal failed");
    }
  }

  async function removeReply(replyId: string) {
    if (!window.confirm("Remove this reply?")) return;
    try {
      await api.del(`/api/communities/replies/${replyId}`);
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Removal failed");
    }
  }

  if (loading) {
    return (
      <AppShell>
        <SkeletonRows rows={3} height={90} />
      </AppShell>
    );
  }
  if (error || !data) {
    return (
      <AppShell>
        <ErrorState message={error ?? "Post not found"} onRetry={reload} />
      </AppShell>
    );
  }

  const { post } = data;

  return (
    <AppShell>
      <Link
        to={`/communities/${post.community.id}`}
        style={{ fontSize: 12.5, color: "var(--ink-soft)" }}
      >
        ← {post.community.name}
      </Link>

      <div className="card" style={{ padding: 20, marginTop: 10 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>{post.title}</h1>
        <div style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 12 }}>
          {post.author} · {new Date(post.createdAt).toLocaleString()}
        </div>
        <p style={{ fontSize: 14, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{post.body}</p>
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            marginTop: 14,
            flexWrap: "wrap",
          }}
        >
          <HelpfulButton count={post.helpful} active={post.reactedByMe} onToggle={reactPost} />
          {!post.mine && <ReportButton targetType="post" targetId={post.id} />}
          {post.mine && (
            <button
              className="btn btn-ghost"
              style={{ fontSize: 11.5, padding: "4px 8px", color: "var(--danger)" }}
              onClick={removePost}
            >
              Remove
            </button>
          )}
        </div>
      </div>

      <InlineError message={actionError} />

      <h2 style={{ fontSize: 14.5, fontWeight: 700, margin: "18px 0 10px" }}>
        {post.replies.length} repl{post.replies.length === 1 ? "y" : "ies"}
      </h2>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {post.replies.map((r) => (
          <div key={r.id} className="card" style={{ padding: 14 }}>
            <div style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 6 }}>
              {r.author} · {new Date(r.createdAt).toLocaleString()}
            </div>
            <p style={{ fontSize: 13.5, whiteSpace: "pre-wrap", lineHeight: 1.55 }}>{r.body}</p>
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10 }}>
              <HelpfulButton
                count={r.helpful}
                active={r.reactedByMe}
                onToggle={() => reactReply(r.id)}
              />
              {!r.mine && <ReportButton targetType="reply" targetId={r.id} />}
              {r.mine && (
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 11.5, padding: "4px 8px", color: "var(--danger)" }}
                  onClick={() => removeReply(r.id)}
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {post.canReply ? (
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          <label className="sr-only" htmlFor="reply-body">Your reply</label>
          <textarea
            id="reply-body"
            className="input"
            rows={3}
            placeholder="Add your thinking — explanations help more than answers."
            value={replyBody}
            maxLength={3000}
            onChange={(e) => setReplyBody(e.target.value)}
          />
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              className="btn btn-primary"
              onClick={sendReply}
              disabled={sending || replyBody.trim().length === 0}
            >
              {sending ? "Sending…" : "Reply"}
            </button>
          </div>
        </div>
      ) : (
        <p style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 14 }}>
          Join {post.community.name} to reply.
        </p>
      )}
    </AppShell>
  );
}
