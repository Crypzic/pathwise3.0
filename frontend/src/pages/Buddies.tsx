// Study Buddy Matching (PATHWISE 2.0 Phase 10): opt in, see suggested
// buddies from derived learning signals, send/accept requests. The privacy
// rule is visible in the UI: matching never shares files, only overlap.
import { useState } from "react";
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
  InlineNotice,
  SkeletonRows,
} from "../components/states";

interface MatchRow {
  userId: string;
  name: string;
  field: string | null;
  academicLevel: string | null;
  studyStyle: string | null;
  score: number;
  reasons: string[];
  sharedTopics: string[];
}

interface RequestsResponse {
  incoming: { id: string; from: string; fromId: string; message: string | null; createdAt: string }[];
  outgoing: { id: string; to: string; toId: string; createdAt: string }[];
}

const LEVEL_LABEL: Record<string, string> = {
  high_school: "High school",
  undergraduate: "Undergraduate",
  graduate: "Graduate",
  professional: "Professional",
  self_taught: "Self-taught",
};

export default function Buddies() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const matchesState = useApi<{ discoverable: boolean; matches: MatchRow[] }>(
    user?.isGuest ? null : "/api/buddies/matches"
  );
  const requestsState = useApi<RequestsResponse>(
    user?.isGuest ? null : "/api/buddies/requests"
  );
  const buddiesState = useApi<{ buddies: { userId: string; name: string; since: string }[] }>(
    user?.isGuest ? null : "/api/buddies"
  );

  if (user?.isGuest) {
    return (
      <AppShell>
        <h1 className="page-title">Study buddies</h1>
        <EmptyState
          icon={<UsersIcon cls="icon-lg" />}
          title="Study buddies need an account"
          body="Get matched with people studying the same topics — create a free account to be discoverable."
          action={
            <Link to="/signup" className="btn btn-primary">
              Create my account
            </Link>
          }
        />
      </AppShell>
    );
  }

  const discoverable = matchesState.data?.discoverable ?? false;

  async function toggleDiscoverable() {
    setBusy("toggle");
    setActionError(null);
    try {
      await api.post("/api/buddies/discoverable", { on: !discoverable });
      matchesState.reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Couldn't update");
    } finally {
      setBusy(null);
    }
  }

  async function sendRequest(m: MatchRow) {
    setBusy(m.userId);
    setActionError(null);
    setNotice(null);
    try {
      await api.post("/api/buddies/requests", { toId: m.userId });
      setNotice(`Request sent to ${m.name}.`);
      requestsState.reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Request failed");
    } finally {
      setBusy(null);
    }
  }

  async function respond(id: string, action: "accept" | "decline") {
    setBusy(id);
    setActionError(null);
    try {
      await api.post(`/api/buddies/requests/${id}/respond`, { action });
      requestsState.reload();
      buddiesState.reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  const incoming = requestsState.data?.incoming ?? [];
  const outgoing = requestsState.data?.outgoing ?? [];
  const outgoingIds = new Set(outgoing.map((o) => o.toId));
  const buddies = buddiesState.data?.buddies ?? [];
  const buddyIds = new Set(buddies.map((b) => b.userId));

  return (
    <AppShell>
      <div className="page-head">
        <div>
          <h1 className="page-title">Study buddies</h1>
          <p className="page-sub">
            Matched on what you're actually studying — never on your files,
            which stay private.
          </p>
        </div>
      </div>

      <div
        className="card"
        style={{
          padding: 16,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        <div style={{ minWidth: 240, flex: 1 }}>
          <div style={{ fontWeight: 650, fontSize: 14 }}>
            {discoverable ? "You're discoverable" : "You're hidden"}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 3 }}>
            {discoverable
              ? "People with overlapping topics can see your name, field and shared topics."
              : "Turn this on to see matches and appear in others' suggestions."}
          </div>
        </div>
        <button
          className={discoverable ? "btn btn-ghost" : "btn btn-primary"}
          onClick={toggleDiscoverable}
          disabled={busy === "toggle"}
        >
          {discoverable ? "Go hidden" : "Make me discoverable"}
        </button>
      </div>

      <InlineNotice message={notice} />
      <InlineError message={actionError} />

      {incoming.length > 0 && (
        <>
          <h2 style={{ fontSize: 14.5, fontWeight: 700, margin: "16px 0 10px" }}>
            Requests for you
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {incoming.map((r) => (
              <div
                key={r.id}
                className="card"
                style={{
                  padding: 14,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <div style={{ fontWeight: 650, fontSize: 13.5 }}>{r.from}</div>
                  {r.message && (
                    <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 2 }}>
                      “{r.message}”
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    className="btn btn-primary"
                    style={{ fontSize: 12.5 }}
                    disabled={busy === r.id}
                    onClick={() => respond(r.id, "accept")}
                  >
                    Accept
                  </button>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 12.5 }}
                    disabled={busy === r.id}
                    onClick={() => respond(r.id, "decline")}
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {buddies.length > 0 && (
        <>
          <h2 style={{ fontSize: 14.5, fontWeight: 700, margin: "16px 0 10px" }}>
            Your buddies
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {buddies.map((b) => (
              <div
                key={b.userId}
                className="card"
                style={{
                  padding: 12,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <span style={{ fontWeight: 650, fontSize: 13.5 }}>
                  {b.name}
                  <span style={{ fontSize: 11, color: "var(--ink-faint)", marginLeft: 8 }}>
                    since {new Date(b.since).toLocaleDateString()}
                  </span>
                </span>
                <button
                  className="btn btn-primary"
                  style={{ fontSize: 12 }}
                  disabled={busy === `room-${b.userId}`}
                  onClick={async () => {
                    setBusy(`room-${b.userId}`);
                    try {
                      const res = await api.post<{ room: { id: string } }>(
                        "/api/rooms",
                        { buddyId: b.userId }
                      );
                      navigate(`/rooms/${res.room.id}`);
                    } catch (err) {
                      setActionError(
                        err instanceof ApiError ? err.message : "Couldn't open the room"
                      );
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  Open study room
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <h2 style={{ fontSize: 14.5, fontWeight: 700, margin: "18px 0 10px" }}>
        Suggested matches
      </h2>

      {matchesState.loading ? (
        <SkeletonRows rows={3} height={92} />
      ) : matchesState.error ? (
        <ErrorState message={matchesState.error} onRetry={matchesState.reload} />
      ) : !discoverable ? (
        <EmptyState
          icon={<UsersIcon cls="icon-lg" />}
          title="Matches are hidden while you are"
          body="Discoverability is mutual: turn it on above to see people studying what you're studying."
        />
      ) : (matchesState.data?.matches.length ?? 0) === 0 ? (
        <EmptyState
          icon={<UsersIcon cls="icon-lg" />}
          title="No overlaps yet"
          body="Matches appear when someone else discoverable shares your topics or subjects. Fill in your learning profile and check back."
          action={
            <Link to="/onboarding" className="btn btn-ghost">
              Edit learning profile
            </Link>
          }
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {matchesState.data!.matches.map((m) => (
            <div key={m.userId} className="card" style={{ padding: 16 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <span style={{ fontWeight: 700, fontSize: 14.5 }}>{m.name}</span>
                  <span
                    className="pill pill-coral"
                    style={{ marginLeft: 8, fontSize: 11 }}
                  >
                    {m.score}% match
                  </span>
                  <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 4 }}>
                    {[
                      m.field,
                      m.academicLevel ? LEVEL_LABEL[m.academicLevel] ?? m.academicLevel : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                {buddyIds.has(m.userId) ? (
                  <span className="pill pill-muted">Buddies ✓</span>
                ) : outgoingIds.has(m.userId) ? (
                  <span className="pill pill-muted">Requested</span>
                ) : (
                  <button
                    className="btn btn-primary"
                    style={{ fontSize: 12.5 }}
                    disabled={busy === m.userId}
                    onClick={() => sendRequest(m)}
                  >
                    Ask to study together
                  </button>
                )}
              </div>
              {m.reasons.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                  {m.reasons.map((r) => (
                    <span key={r} className="pill pill-muted" style={{ fontSize: 11 }}>
                      {r}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
