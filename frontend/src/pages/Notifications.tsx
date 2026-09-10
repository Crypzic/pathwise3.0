// Dedicated notifications inbox (Isaac's UX review, item 3). The bell in the
// rail links here; read state is real server state (readAt), so it survives
// refreshes — "Mark all read" hits the API, not just local state.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell, { NOTIFICATIONS_CHANGED_EVENT } from "../components/AppShell";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { BellIcon, CheckIcon } from "../components/icons";
import { EmptyState, ErrorState, SkeletonRows } from "../components/states";

interface NotificationRow {
  id: string;
  kind: string;
  title: string;
  body: string;
  deepLink: string | null;
  read: boolean;
  createdAt: string;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function Notifications() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const { data, loading, error, reload } = useApi<{
    notifications: NotificationRow[];
    unreadCount: number;
  }>("/api/notifications");

  const rows = data?.notifications ?? [];
  const unread = data?.unreadCount ?? 0;

  function badgeChanged() {
    window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
  }

  async function markAllRead() {
    setBusy(true);
    try {
      await api.post("/api/notifications/read", {});
      badgeChanged();
      reload();
    } catch {
      // The reload will show the true state either way.
      reload();
    } finally {
      setBusy(false);
    }
  }

  async function open(r: NotificationRow) {
    if (!r.read) {
      // Fire-and-forget: don't make navigation wait on the write.
      api
        .post("/api/notifications/read", { ids: [r.id] })
        .then(badgeChanged)
        .catch(() => {});
    }
    if (r.deepLink) {
      navigate(r.deepLink);
    } else {
      reload();
    }
  }

  return (
    <AppShell>
      <div className="page-head">
        <div>
          <h1 className="page-title">Notifications</h1>
          <p className="page-sub">
            {unread > 0
              ? `${unread} unread notification${unread === 1 ? "" : "s"}.`
              : "You're all caught up."}
          </p>
        </div>
        {unread > 0 && (
          <button className="btn btn-ghost" onClick={markAllRead} disabled={busy}>
            <CheckIcon cls="icon-sm" /> Mark all as read
          </button>
        )}
      </div>

      {loading ? (
        <SkeletonRows rows={5} height={64} />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<BellIcon cls="icon-lg" />}
          title="Nothing yet"
          body="Streak reminders, review nudges, buddy requests and unlocks will land here."
        />
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          {rows.map((r) => (
            <div
              key={r.id}
              className={`notif-row ${r.read ? "read" : "unread"}`}
              onClick={() => open(r)}
              role={r.deepLink ? "button" : undefined}
              tabIndex={r.deepLink ? 0 : undefined}
              onKeyDown={(e) => {
                if (r.deepLink && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  void open(r);
                }
              }}
              style={{ cursor: r.deepLink ? "pointer" : "default" }}
            >
              <span className="n-unread-dot" aria-hidden="true" />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="n-title">
                  {r.title}
                  {!r.read && <span className="sr-only"> (unread)</span>}
                </div>
                <div className="n-body">{r.body}</div>
              </div>
              <span className="n-time">{timeAgo(r.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
