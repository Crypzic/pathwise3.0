// Communities (PATHWISE 2.0 Phase 9, reshaped per the 2.0 frontend spec):
// no hardcoded catalog — the default view shows communities matching the
// learner's own subjects/interests, search covers everything, and anyone
// can create one (behind the server's educational guardrail).
// Account-gated: guests see a claim-your-account nudge instead (the server
// enforces the same rule with a 403; this is just the friendlier version).
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import { api, ApiError } from "../lib/api";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { UsersIcon } from "../components/icons";
import {
  EmptyState,
  ErrorState,
  InlineError,
  SkeletonRows,
} from "../components/states";

interface CommunityRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  parentId: string | null;
  members: number;
  posts: number;
  joined: boolean;
  relevant: boolean;
}

function CommunityCard({
  c,
  childrenRows,
  onToggle,
  busy,
}: {
  c: CommunityRow;
  childrenRows: CommunityRow[];
  onToggle: (c: CommunityRow) => void;
  busy: string | null;
}) {
  const navigate = useNavigate();
  return (
    <div className="card" style={{ padding: 18 }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 220, flex: 1 }}>
          <Link
            to={`/communities/${c.id}`}
            style={{ fontWeight: 700, fontSize: 15.5, color: "var(--ink)" }}
          >
            {c.name}
          </Link>
          <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 6, lineHeight: 1.5 }}>
            {c.description}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: 8 }}>
            {c.members} member{c.members === 1 ? "" : "s"} · {c.posts} post
            {c.posts === 1 ? "" : "s"}
          </div>
        </div>
        <button
          className={c.joined ? "btn btn-ghost btn-sm" : "btn btn-primary btn-sm"}
          disabled={busy === c.id}
          onClick={() => onToggle(c)}
        >
          {c.joined ? "Leave" : "Join"}
        </button>
      </div>

      {childrenRows.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          {childrenRows.map((child) => (
            <button
              key={child.id}
              className="pill pill-muted"
              onClick={() => navigate(`/communities/${child.id}`)}
              style={{ cursor: "pointer", border: "none", fontSize: 12 }}
              title={child.description}
            >
              {child.name}
              {child.joined ? " ✓" : ""}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Communities() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const { data, loading, error, reload } = useApi<{ communities: CommunityRow[] }>(
    user?.isGuest
      ? null
      : search
        ? `/api/communities?q=${encodeURIComponent(search)}`
        : "/api/communities",
    [search]
  );

  async function createCommunity(e: FormEvent) {
    e.preventDefault();
    if (newName.trim().length < 3 || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await api.post<{ community: { id: string } }>(
        "/api/communities",
        { name: newName, description: newDescription }
      );
      navigate(`/communities/${res.community.id}`);
    } catch (err) {
      // The guardrail's message arrives verbatim from the server.
      setCreateError(
        err instanceof ApiError ? err.message : "Couldn't create that community."
      );
    } finally {
      setCreating(false);
    }
  }

  if (user?.isGuest) {
    return (
      <AppShell>
        <h1 className="page-title">Communities</h1>
        <EmptyState
          icon={<UsersIcon cls="icon-lg" />}
          title="Communities need an account"
          body="Join subject communities, ask questions and find people studying the same thing — create a free account to keep your identity."
          action={
            <Link to="/signup" className="btn btn-primary">
              Create my account
            </Link>
          }
        />
      </AppShell>
    );
  }

  async function toggle(c: CommunityRow) {
    // Leaving is deliberate — confirm. Membership only, never the community.
    if (c.joined && !window.confirm(`Are you sure you want to leave ${c.name}?`)) {
      return;
    }
    setBusy(c.id);
    try {
      await api.post(`/api/communities/${c.id}/${c.joined ? "leave" : "join"}`, {});
      reload();
    } catch {
      // The reload sorts out any state drift.
      reload();
    } finally {
      setBusy(null);
    }
  }

  const rows = data?.communities ?? [];
  // No search: show the learner's world — joined + subject-matched.
  const visible = search ? rows : rows.filter((c) => c.relevant);
  const roots = visible.filter(
    (c) => c.parentId === null || !visible.some((p) => p.id === c.parentId)
  );
  const childrenOf = (id: string) => visible.filter((c) => c.parentId === id);
  const joinedCount = rows.filter((c) => c.joined).length;

  const createForm = (
    <form
      onSubmit={createCommunity}
      className="card"
      style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}
    >
      <div className="field">
        <label htmlFor="community-name">Community name</label>
        <input
          id="community-name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="e.g. Organic Chemistry, Contract Law, CS50"
          maxLength={60}
        />
      </div>
      <div className="field">
        <label htmlFor="community-description">What is it about?</label>
        <input
          id="community-description"
          value={newDescription}
          onChange={(e) => setNewDescription(e.target.value)}
          placeholder="One sentence about the course or subject"
          maxLength={300}
        />
      </div>
      <InlineError message={createError} />
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={creating || newName.trim().length < 3}
        >
          {creating ? "Checking…" : "Create community"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            setShowCreate(false);
            setCreateError(null);
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );

  return (
    <AppShell>
      <div className="page-head">
        <div>
          <h1 className="page-title">Communities</h1>
          <p className="page-sub">
            Spaces for the subjects you actually study.
            {joinedCount > 0 ? ` You're in ${joinedCount}.` : ""}
          </p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => setShowCreate((s) => !s)}
        >
          + New community
        </button>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(query.trim());
        }}
        className="toolbar"
        role="search"
      >
        <label className="sr-only" htmlFor="community-search">
          Search communities
        </label>
        <input
          id="community-search"
          className="input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search all communities…"
          style={{ flex: 1 }}
        />
        <button type="submit" className="btn btn-ghost">
          Search
        </button>
        {search && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setQuery("");
              setSearch("");
            }}
          >
            Clear
          </button>
        )}
      </form>

      {showCreate && createForm}

      {loading ? (
        <SkeletonRows rows={4} height={110} />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : roots.length === 0 ? (
        <EmptyState
          icon={<UsersIcon cls="icon-lg" />}
          title={
            search
              ? `Nothing matches “${search}”`
              : "No communities for your subjects yet"
          }
          body={
            search
              ? "Try another search — or start this community yourself."
              : "Be the first: create a community for one of your courses, or search everything that exists."
          }
          action={
            <button
              className="btn btn-primary"
              onClick={() => setShowCreate(true)}
            >
              Create a community
            </button>
          }
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {roots.map((c) => (
            <CommunityCard
              key={c.id}
              c={c}
              childrenRows={childrenOf(c.id)}
              onToggle={toggle}
              busy={busy}
            />
          ))}
        </div>
      )}
    </AppShell>
  );
}
