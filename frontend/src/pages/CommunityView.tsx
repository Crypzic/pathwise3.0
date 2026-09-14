// One community (PATHWISE 2.0 Phase 9): its posts, sub-communities and a
// composer for members. Joining happens here too so a deep link works.
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import { api, ApiError } from "../lib/api";
import { useApi } from "../lib/useApi";
import { Avatar } from "../components/Avatar";
import { UsersIcon } from "../components/icons";
import { StaggerContainer, StaggerItem } from "../components/motion";
import {
  EmptyState,
  ErrorState,
  InlineError,
  SkeletonRows,
} from "../components/states";

interface PostRow {
  id: string;
  kind: string;
  title: string;
  author: string;
  authorId: string;
  authorAvatarUrl: string | null;
  authorAvatarFrame: string;
  mine: boolean;
  replies: number;
  helpful: number;
  reactedByMe: boolean;
  createdAt: string;
}

interface MemberRow {
  userId: string;
  name: string;
  avatarUrl: string | null;
  avatarFrame: string;
  me: boolean;
}

interface CommunityResponse {
  community: {
    id: string;
    slug: string;
    name: string;
    description: string;
    members: number;
    children: { id: string; name: string; slug: string }[];
    joined: boolean;
  };
  members: MemberRow[];
  posts: PostRow[];
  nextCursor: string | null;
}

const KIND_LABEL: Record<string, string> = {
  question: "Question",
  discussion: "Discussion",
  resource: "Resource",
};

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function Composer({
  communityId,
  onPosted,
}: {
  communityId: string;
  onPosted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("question");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSending(true);
    setError(null);
    try {
      await api.post(`/api/communities/${communityId}/posts`, {
        kind,
        title,
        body,
      });
      setTitle("");
      setBody("");
      setOpen(false);
      onPosted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Posting failed — try again.");
    } finally {
      setSending(false);
    }
  }

  if (!open) {
    return (
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        Start a discussion
      </button>
    );
  }

  return (
    <div className="card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 8 }}>
        {Object.entries(KIND_LABEL).map(([k, label]) => (
          <button
            key={k}
            className={kind === k ? "pill pill-coral" : "pill pill-muted"}
            onClick={() => setKind(k)}
            style={{ cursor: "pointer", border: "none" }}
          >
            {label}
          </button>
        ))}
      </div>
      <label className="sr-only" htmlFor="post-title">Title</label>
      <input
        id="post-title"
        className="input"
        placeholder={kind === "question" ? "What are you stuck on?" : "Give it a title"}
        value={title}
        maxLength={140}
        onChange={(e) => setTitle(e.target.value)}
      />
      <label className="sr-only" htmlFor="post-body">Body</label>
      <textarea
        id="post-body"
        className="input"
        placeholder="Details — what you've tried, where it got confusing…"
        rows={4}
        value={body}
        maxLength={5000}
        onChange={(e) => setBody(e.target.value)}
      />
      <InlineError message={error} />
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="btn btn-ghost" onClick={() => setOpen(false)} disabled={sending}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          onClick={submit}
          disabled={sending || title.trim().length < 4 || body.trim().length === 0}
        >
          {sending ? "Posting…" : "Post"}
        </button>
      </div>
    </div>
  );
}

/** Tap a member's face → send them a message request right here. */
function MemberStrip({ members }: { members: MemberRow[] }) {
  const navigate = useNavigate();
  const [target, setTarget] = useState<MemberRow | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const others = members.filter((m) => !m.me);
  if (others.length === 0) return null;

  async function send() {
    if (!target || body.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ conversation: { id: string } }>("/api/dms", {
        toId: target.userId,
        body: body.trim(),
      });
      navigate(`/messages/${res.conversation.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't send that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ margin: "4px 0 14px" }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {others.slice(0, 12).map((m) => (
          <button
            key={m.userId}
            className="icon-btn"
            style={{ width: "auto", height: "auto", padding: 3, borderRadius: 50 }}
            title={`Message ${m.name}`}
            aria-label={`Message ${m.name}`}
            onClick={() => {
              setTarget(target?.userId === m.userId ? null : m);
              setBody("");
              setError(null);
            }}
          >
            <Avatar name={m.name} url={m.avatarUrl} frame={m.avatarFrame} size={34} />
          </button>
        ))}
      </div>
      {target && (
        <div className="card" style={{ padding: 12, marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>
            Send <strong>{target.name}</strong> a message request:
          </span>
          <InlineError message={error} />
          <div style={{ display: "flex", gap: 8 }}>
            <input
              className="input"
              style={{ flex: 1 }}
              placeholder="Say hi…"
              value={body}
              maxLength={3000}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void send();
              }}
            />
            <button
              className="btn btn-primary btn-sm"
              onClick={send}
              disabled={busy || body.trim().length === 0}
            >
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CommunityView() {
  const { id } = useParams<{ id: string }>();
  const [joinBusy, setJoinBusy] = useState(false);
  const { data, loading, error, reload } = useApi<CommunityResponse>(
    id ? `/api/communities/${id}` : null
  );

  async function toggleJoin() {
    if (!data || !id) return;
    // Leaving is deliberate — confirm it. Membership only; the community
    // itself is untouched either way.
    if (
      data.community.joined &&
      !window.confirm(`Are you sure you want to leave ${data.community.name}?`)
    ) {
      return;
    }
    setJoinBusy(true);
    try {
      await api.post(
        `/api/communities/${id}/${data.community.joined ? "leave" : "join"}`,
        {}
      );
    } finally {
      setJoinBusy(false);
      reload();
    }
  }

  if (loading) {
    return (
      <AppShell>
        <SkeletonRows rows={4} height={80} />
      </AppShell>
    );
  }
  if (error || !data) {
    return (
      <AppShell>
        <ErrorState message={error ?? "Community not found"} onRetry={reload} />
      </AppShell>
    );
  }

  const { community, posts } = data;

  return (
    <AppShell>
      <div className="page-head" style={{ flexWrap: "wrap", gap: 12 }}>
        <div>
          <Link to="/communities" style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>
            ← All communities
          </Link>
          <h1 className="page-title" style={{ marginTop: 4 }}>{community.name}</h1>
          <p className="page-sub">
            {community.description} · {community.members} member
            {community.members === 1 ? "" : "s"}
          </p>
          {community.children.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              {community.children.map((c) => (
                <Link key={c.id} to={`/communities/${c.id}`} className="pill pill-muted">
                  {c.name}
                </Link>
              ))}
            </div>
          )}
        </div>
        <button
          className={community.joined ? "btn btn-ghost" : "btn btn-primary"}
          onClick={toggleJoin}
          disabled={joinBusy}
          style={community.joined ? { color: "var(--danger)", borderColor: "var(--danger)" } : undefined}
        >
          {joinBusy ? "…" : community.joined ? "Leave community" : "Join"}
        </button>
      </div>

      {/* Who's here — tap a face to message them (Phase 2.3). */}
      <MemberStrip members={data.members} />

      <div style={{ margin: "14px 0" }}>
        {community.joined ? (
          <Composer communityId={community.id} onPosted={reload} />
        ) : (
          <p style={{ fontSize: 13, color: "var(--ink-soft)" }}>
            Join to post and reply.
          </p>
        )}
      </div>

      {posts.length === 0 ? (
        <EmptyState
          icon={<UsersIcon cls="icon-lg" />}
          title="No posts yet"
          body="Be the first — ask the question you're actually stuck on."
        />
      ) : (
        <StaggerContainer style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {posts.map((p) => (
            <StaggerItem key={p.id}>
            <Link
              to={`/communities/posts/${p.id}`}
              className="card"
              style={{ padding: 16, display: "block" }}
            >
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span className="pill pill-muted" style={{ fontSize: 10.5 }}>
                  {KIND_LABEL[p.kind] ?? p.kind}
                </span>
                <span style={{ fontWeight: 650, fontSize: 14.5 }}>{p.title}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--ink-soft)", marginTop: 8 }}>
                <Avatar name={p.author} url={p.authorAvatarUrl} frame={p.authorAvatarFrame} size={20} />
                {p.author} · {timeAgo(p.createdAt)} · {p.replies} repl
                {p.replies === 1 ? "y" : "ies"}
                {p.helpful > 0 ? ` · ${p.helpful} found this helpful` : ""}
              </div>
            </Link>
            </StaggerItem>
          ))}
        </StaggerContainer>
      )}
    </AppShell>
  );
}
