// Communities (PATHWISE 2.0 Phase 9) — browse the subject tree and join.
// Account-gated: guests see a claim-your-account nudge instead (the server
// enforces the same rule with a 403; this is just the friendlier version).
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { UsersIcon } from "../components/icons";
import { EmptyState, ErrorState, SkeletonRows } from "../components/states";

interface CommunityRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  parentId: string | null;
  members: number;
  posts: number;
  joined: boolean;
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
          <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 4 }}>
            {c.description}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: 6 }}>
            {c.members} member{c.members === 1 ? "" : "s"} · {c.posts} post
            {c.posts === 1 ? "" : "s"}
          </div>
        </div>
        <button
          className={c.joined ? "btn btn-ghost" : "btn btn-primary"}
          disabled={busy === c.id}
          onClick={() => onToggle(c)}
          style={{ fontSize: 12.5 }}
        >
          {c.joined ? "Joined ✓" : "Join"}
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
  const [busy, setBusy] = useState<string | null>(null);
  const { data, loading, error, reload } = useApi<{ communities: CommunityRow[] }>(
    user?.isGuest ? null : "/api/communities"
  );

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
  const roots = rows.filter((c) => c.parentId === null);
  const childrenOf = (id: string) => rows.filter((c) => c.parentId === id);
  const joinedCount = rows.filter((c) => c.joined).length;

  return (
    <AppShell>
      <div className="page-head">
        <div>
          <h1 className="page-title">Communities</h1>
          <p className="page-sub">
            Subject spaces for questions, discussions and shared resources.
            {joinedCount > 0 ? ` You're in ${joinedCount}.` : ""}
          </p>
        </div>
      </div>

      {loading ? (
        <SkeletonRows rows={4} height={110} />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : roots.length === 0 ? (
        <EmptyState
          icon={<UsersIcon cls="icon-lg" />}
          title="No communities yet"
          body="Communities are being set up — check back shortly."
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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
