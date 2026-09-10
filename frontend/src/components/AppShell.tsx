// Top rail (logo + toggle + notifications + profile) and a hidden-by-default
// sidebar drawer, used on every signed-in screen. Profile stays as the top-right
// avatar trigger — deliberately NOT in the drawer.
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "../lib/auth";
import { useFeatures } from "../lib/features";
import { api } from "../lib/api";
import { LogoFull } from "./Logo";
import { Avatar } from "./Avatar";
import {
  HomeIcon,
  PuzzleIcon,
  SparklesIcon,
  ChartIcon,
  FlameIcon,
  ChevronDownIcon,
  GamepadIcon,
  PanelLeftIcon,
  BellIcon,
  MailIcon,
  UsersIcon,
  UploadIcon,
} from "./icons";

function navClass({ isActive }: { isActive: boolean }) {
  return isActive ? "nav-item active" : "nav-item";
}

/** The Notifications page fires this after changing read state, so the badge
 *  here updates immediately instead of waiting for the next poll. */
export const NOTIFICATIONS_CHANGED_EVENT = "pathwise:notifications-changed";

/** Bell = badge + link to the dedicated /notifications page (Step 12,
 *  reshaped per Isaac's UX review — the inbox lives on its own page now). */
function NotificationBell() {
  const navigate = useNavigate();
  const [unread, setUnread] = useState(0);

  // Poll rather than hold a socket open — notifications here are day-scale, so
  // a socket would be a lot of infrastructure for no user-visible gain.
  useEffect(() => {
    let active = true;
    const load = () => {
      api
        .get<{ unreadCount: number }>("/api/notifications")
        .then((res) => {
          if (active) setUnread(res.unreadCount);
        })
        .catch(() => {
          // A failed badge poll is not worth surfacing.
        });
    };
    load();
    const timer = window.setInterval(load, 120_000);
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, load);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, load);
    };
  }, []);

  return (
    <button
      className="icon-btn bell-btn"
      onClick={() => navigate("/notifications")}
      aria-label={
        unread > 0 ? `Notifications, ${unread} unread` : "Notifications"
      }
      title="Notifications"
    >
      <BellIcon cls="icon" />
      {unread > 0 && <span className="bell-dot">{unread > 9 ? "9+" : unread}</span>}
    </button>
  );
}

export default function AppShell({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { leafMatch, userVideoPosting } = useFeatures();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  // Username wins wherever we show who this is — the name is the fallback.
  const shownName = user?.username || user?.name || "?";

  // The drawer's study-plan link needs a course. Remembering the last-viewed
  // one keeps the nav item useful instead of pointing at a hardcoded id.
  const lastCourseId = localStorage.getItem("pathwise_last_course");

  // Close the drawer on Escape — it's a focus trap otherwise.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>

      <div className="rail">
        <button
          className={`icon-btn rail-toggle ${open ? "open" : ""}`}
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Close navigation" : "Open navigation"}
          aria-expanded={open}
          title={open ? "Close menu" : "Menu"}
        >
          <PanelLeftIcon cls="icon" />
        </button>
        <button
          onClick={() => navigate("/courses")}
          style={{ cursor: "pointer", background: "none", border: "none", padding: 0 }}
          aria-label="Pathwise home"
        >
          <LogoFull height={26} />
        </button>

        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          {user && (
            <span className="rank-chip" title={`${user.xp} XP`}>
              <span className="mono">Lv.{user.rank?.level ?? 1}</span>
              <span className="rank-bar" aria-hidden="true">
                <span style={{ width: `${Math.round((user.rank?.progress ?? 0) * 100)}%` }} />
              </span>
              <span className="sr-only">
                {user.xp} XP, rank {user.rank?.name}
              </span>
            </span>
          )}
          <NotificationBell />
          <button
            className="profile-trigger"
            onClick={() => navigate("/profile")}
            title="Profile"
          >
            <Avatar
              name={shownName}
              url={user?.avatarUrl}
              frame={user?.avatarFrame}
              size={36}
            />
            <span className="name">{shownName}</span>
            <ChevronDownIcon cls="icon-sm chev" />
          </button>
        </div>
      </div>

      <div
        className={`sidebar-backdrop ${open ? "open" : ""}`}
        onClick={() => setOpen(false)}
      />
      <aside
        className={`sidebar-drawer ${open ? "open" : ""}`}
        aria-label="Main navigation"
        aria-hidden={!open}
      >
        <nav className="nav-list" onClick={() => setOpen(false)}>
          <NavLink to="/courses" className={navClass} end>
            <HomeIcon /> Courses
          </NavLink>
          {lastCourseId && (
            <NavLink to={`/study-plan/${lastCourseId}`} className={navClass}>
              <ChartIcon /> Study plan
            </NavLink>
          )}
          <NavLink to="/quiz" className={navClass}>
            <PuzzleIcon /> Quiz
          </NavLink>
          <NavLink to="/socratic" className={navClass}>
            <SparklesIcon /> Socratic mode
          </NavLink>
          {lastCourseId && (
            <NavLink to={`/progress/${lastCourseId}`} className={navClass}>
              <ChartIcon /> Progress
            </NavLink>
          )}
          <NavLink to="/communities" className={navClass}>
            <UsersIcon /> Communities
          </NavLink>
          <NavLink to="/buddies" className={navClass}>
            <UsersIcon /> Study buddies
          </NavLink>
          <NavLink to="/messages" className={navClass}>
            <MailIcon cls="icon" /> Messages
          </NavLink>
          <NavLink to="/videos" className={navClass}>
            <SparklesIcon cls="icon" /> Videos
          </NavLink>
          {userVideoPosting && (
            <NavLink to="/creator" className={navClass}>
              <UploadIcon cls="icon" /> Creator Studio
            </NavLink>
          )}
          {leafMatch && (
            <NavLink to="/game" className={navClass}>
              <GamepadIcon /> Sprout's Garden
            </NavLink>
          )}
        </nav>
        <div className="sidebar-streak">
          <FlameIcon cls="icon-lg" style={{ color: "var(--accent)" }} />
          <div>
            <div className="mono" style={{ fontWeight: 700, fontSize: 14 }}>
              {user?.streakCount ?? 0} day streak
            </div>
            <div style={{ fontSize: 11, color: "var(--ink-soft)" }}>
              Best: {user?.bestStreak ?? 0} days
            </div>
          </div>
        </div>
      </aside>

      <main
        id="main-content"
        className="main"
        style={{ maxWidth: 1100, margin: "0 auto" }}
      >
        {user?.isGuest && (
          <div
            className="form-notice"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
              marginBottom: 14,
            }}
          >
            <span>
              You're browsing as a guest —{" "}
              {user.guestDaysLeft === 1
                ? "everything is deleted tomorrow."
                : `everything is deleted in ${user.guestDaysLeft ?? 7} days.`}
            </span>
            <NavLink to="/signup" className="btn btn-primary" style={{ flexShrink: 0 }}>
              Keep my progress
            </NavLink>
          </div>
        )}
        <div key={location.pathname} className="page-fade-in">
          {children}
        </div>
      </main>
    </>
  );
}
