// Profile (Step 10) — real editing, profile picture + rank-gated frames,
// theme choice (Step 16 item 5), referrals (Step 14) and account deletion with
// a 30-day recovery window. Notifications are automatic — no settings for them.
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useFeatures } from "../lib/features";
import { useApi } from "../lib/useApi";
import { useTheme, type ThemePreference } from "../lib/theme";
import { Collapsible } from "../components/Collapsible";
import { Avatar } from "../components/Avatar";
import {
  AwardIcon,
  CameraIcon,
  GamepadIcon,
  LockIcon,
  ShoppingBagIcon,
  SnowflakeIcon,
  SparklesIcon,
} from "../components/icons";
import {
  ErrorState,
  InlineError,
  InlineNotice,
  SkeletonRows,
} from "../components/states";

interface ProfileResponse {
  profile: {
    id: string;
    name: string;
    username: string | null;
    email: string;
    timezone: string;
    avatarUrl: string | null;
    avatarFrame: string;
  };
  progress: {
    xp: number;
    rank: { level: number; name: string; progress: number; nextXp: number | null };
    streakCount: number;
    bestStreak: number;
    streakFreezes: number;
    gardenXp: number;
  };
  subscription: {
    tier: string;
    interval: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  };
  badges: { key: string; name: string; description: string }[];
  frames: {
    key: string;
    name: string;
    description: string;
    requiredLevel: number;
    unlocked: boolean;
    selected: boolean;
  }[];
  ranks: { level: number; name: string; minXp: number; reached: boolean }[];
  referral: {
    code: string;
    link: string;
    invited: number;
    rewarded: number;
    promptUnlocked: boolean;
  };
  companion: { name: string; growth: number; equipped: string[] } | null;
}

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

export default function Profile() {
  const { logout, refresh } = useAuth();
  const { leafMatch } = useFeatures();
  const navigate = useNavigate();
  const { preference, setPreference } = useTheme();
  const { data, loading, error, reload } = useApi<ProfileResponse>("/api/profile");

  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [frameBusy, setFrameBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const [deleting, setDeleting] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [copied, setCopied] = useState(false);

  const [feedbackDraft, setFeedbackDraft] = useState("");
  const [feedbackBusy, setFeedbackBusy] = useState(false);

  async function sendFeedback() {
    if (feedbackDraft.trim().length < 3) return;
    setFeedbackBusy(true);
    setSaveError(null);
    setNotice(null);
    try {
      const res = await api.post<{ message: string }>("/api/feedback", {
        message: feedbackDraft.trim(),
        context: window.location.pathname,
      });
      setNotice(res.message);
      setFeedbackDraft("");
    } catch (err) {
      setSaveError(
        err instanceof ApiError ? err.message : "Couldn't send that just now."
      );
    } finally {
      setFeedbackBusy(false);
    }
  }

  // Seed the form once the profile arrives.
  useEffect(() => {
    if (!data) return;
    setName(data.profile.name);
    setUsername(data.profile.username ?? "");
    setEmail(data.profile.email);
  }, [data]);

  async function save() {
    setSaving(true);
    setSaveError(null);
    setNotice(null);
    try {
      await api.patch("/api/profile", {
        name: name.trim(),
        username: username.trim() || undefined,
        email: email.trim(),
      });
      setNotice("Saved.");
      await refresh();
      reload();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  async function uploadAvatar(file: File) {
    setAvatarBusy(true);
    setSaveError(null);
    setNotice(null);
    try {
      await api.upload("/api/profile/avatar", file);
      await refresh();
      reload();
      setNotice("Profile picture updated.");
    } catch (err) {
      setSaveError(
        err instanceof ApiError ? err.message : "Couldn't upload that picture."
      );
    } finally {
      setAvatarBusy(false);
    }
  }

  async function removeAvatar() {
    setAvatarBusy(true);
    setSaveError(null);
    setNotice(null);
    try {
      await api.del("/api/profile/avatar");
      await refresh();
      reload();
    } catch (err) {
      setSaveError(
        err instanceof ApiError ? err.message : "Couldn't remove the picture."
      );
    } finally {
      setAvatarBusy(false);
    }
  }

  async function chooseFrame(key: string) {
    setFrameBusy(true);
    setSaveError(null);
    try {
      await api.post("/api/profile/frame", { frame: key });
      await refresh();
      reload();
    } catch (err) {
      setSaveError(
        err instanceof ApiError ? err.message : "Couldn't switch frames."
      );
    } finally {
      setFrameBusy(false);
    }
  }

  async function changePassword() {
    setSaveError(null);
    setNotice(null);
    if (newPassword.length < 8) {
      setSaveError("New password must be at least 8 characters.");
      return;
    }
    try {
      await api.post("/api/profile/password", { currentPassword, newPassword });
      setNotice("Password updated.");
      setCurrentPassword("");
      setNewPassword("");
    } catch (err) {
      setSaveError(
        err instanceof ApiError ? err.message : "Couldn't change your password."
      );
    }
  }

  async function deleteAccount() {
    setSaveError(null);
    try {
      const res = await api.post<{ message: string }>("/api/profile/delete", {
        password: deletePassword,
      });
      // Signing out immediately is the honest thing to do — the account is gone
      // from the user's point of view, recoverable only by signing back in.
      alert(res.message);
      logout();
      navigate("/signin");
    } catch (err) {
      setSaveError(
        err instanceof ApiError ? err.message : "Couldn't delete the account."
      );
    }
  }

  // The export endpoint needs the bearer token, so a plain <a href> won't do —
  // fetch it and hand the browser a blob.
  async function exportData() {
    setSaveError(null);
    try {
      const payload = await api.get<unknown>("/api/profile/export");
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "pathwise-export.json";
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setSaveError(
        err instanceof ApiError ? err.message : "Couldn't prepare your export."
      );
    }
  }

  async function copyReferral(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setSaveError("Couldn't copy — you can select the link manually.");
    }
  }

  if (loading) {
    return (
      <AppShell>
        <div className="skeleton" style={{ height: 24, width: 170, marginBottom: 18 }} />
        <SkeletonRows rows={4} height={80} />
      </AppShell>
    );
  }

  if (error || !data) {
    return (
      <AppShell>
        <ErrorState message={error ?? "Couldn't load your profile."} onRetry={reload} />
      </AppShell>
    );
  }

  const { progress, subscription, badges, frames, referral, companion } = data;
  const isPremium = subscription.tier === "premium";
  // Username wins wherever we show who this is — the name is the fallback.
  const shownName = data.profile.username || data.profile.name;

  return (
    <AppShell>
      <div className="eyebrow">Your profile</div>
      <h1 className="section-title" style={{ marginBottom: 22 }}>
        Account settings
      </h1>

      <InlineError message={saveError} />
      <InlineNotice message={notice} />

      {/* Identity + rank — username above the rank pill, picture + frame live. */}
      <div
        className="card"
        style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 22 }}
      >
        <span style={{ position: "relative", display: "inline-flex", flexShrink: 0 }}>
          <Avatar
            name={shownName}
            url={data.profile.avatarUrl}
            frame={data.profile.avatarFrame}
            size={64}
          />
          <button
            className="avatar-upload"
            onClick={() => fileInputRef.current?.click()}
            disabled={avatarBusy}
            aria-label="Upload a profile picture"
            title="Upload a profile picture"
          >
            <CameraIcon cls="icon-sm" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadAvatar(file);
              e.target.value = "";
            }}
          />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{shownName}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
            <span className="pill pill-coral">
              <AwardIcon cls="icon-sm" /> {progress.rank.name} · Lv. {progress.rank.level}
            </span>
            {isPremium && (
              <span className="pill pill-mint">
                <SparklesIcon cls="icon-sm" /> Pro
              </span>
            )}
            {progress.streakFreezes > 0 && (
              <span className="pill pill-green">
                <SnowflakeIcon cls="icon-sm" /> {progress.streakFreezes} freeze
                {progress.streakFreezes === 1 ? "" : "s"}
              </span>
            )}
          </div>
          <div style={{ marginTop: 10 }}>
            <div className="progress-track" aria-hidden="true">
              <div
                className="progress-fill"
                style={{ width: `${Math.round(progress.rank.progress * 100)}%` }}
              />
            </div>
            <div style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: 5 }}>
              {progress.xp.toLocaleString()} XP
              {progress.rank.nextXp !== null &&
                ` · ${(progress.rank.nextXp - progress.xp).toLocaleString()} to next rank`}
              {data.profile.avatarUrl && (
                <>
                  {" · "}
                  <button
                    onClick={removeAvatar}
                    disabled={avatarBusy}
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      font: "inherit",
                      color: "var(--ink-faint)",
                      textDecoration: "underline",
                      cursor: "pointer",
                    }}
                  >
                    Remove photo
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Frame picker — live previews rendered by the same Avatar component
          the rest of the app uses, so what you pick is what you get. */}
      <div className="card" style={{ marginBottom: 22 }}>
        <h2 style={{ fontSize: 14.5, marginBottom: 6 }}>Profile frames</h2>
        <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 14 }}>
          Pick how your avatar is framed across Pathwise. More unlock as you
          level up.
        </p>
        <div className="frame-picker">
          {frames.map((f) => (
            <button
              key={f.key}
              className={`frame-option${f.unlocked ? "" : " locked"}`}
              aria-pressed={f.selected}
              disabled={!f.unlocked || frameBusy}
              onClick={() => chooseFrame(f.key)}
              title={f.description}
            >
              <Avatar
                name={shownName}
                url={data.profile.avatarUrl}
                frame={f.key}
                size={52}
              />
              <span className="fo-name">{f.name}</span>
              {f.unlocked ? (
                <span className="fo-req">{f.selected ? "In use" : "Tap to wear"}</span>
              ) : (
                <span
                  className="fo-req"
                  style={{ display: "inline-flex", alignItems: "center", gap: 3 }}
                >
                  <LockIcon cls="icon-sm" /> Level {f.requiredLevel}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Edit details */}
      <div className="card" style={{ marginBottom: 22 }}>
        <h2 style={{ fontSize: 14.5, marginBottom: 16 }}>Edit details</h2>
        <div className="field">
          <label htmlFor="p-name">Full name</label>
          <input id="p-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="p-username">Username</label>
          <input
            id="p-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="optional"
          />
          <span className="hint">Letters, numbers and underscores. 3–24 characters.</span>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="p-email">Email</label>
          <input
            id="p-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
      </div>

      {/* Appearance (Step 16 item 5) */}
      <div className="card" style={{ marginBottom: 22 }}>
        <h2 style={{ fontSize: 14.5, marginBottom: 6 }}>Appearance</h2>
        <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 14 }}>
          Socratic Mode keeps its own dark theme either way — that's deliberate.
        </p>
        <div className="segmented" role="group" aria-label="Theme">
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setPreference(opt.value)}
              aria-pressed={preference === opt.value}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <button
        className="btn btn-primary btn-block"
        onClick={save}
        disabled={saving}
        style={{ marginBottom: 22 }}
      >
        {saving ? "Saving…" : "Save changes"}
      </button>

      {/* Learning profile (PATHWISE 2.0 Phase 2) — the onboarding answers,
          editable any time. */}
      <div className="card" style={{ marginBottom: 22, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ fontSize: 14.5, marginBottom: 4 }}>Learning profile</h2>
          <p style={{ fontSize: 12.5, color: "var(--ink-soft)", margin: 0 }}>
            What you study and how you like to learn — used to personalize Pathwise.
          </p>
        </div>
        <Link to="/onboarding" className="btn btn-ghost" style={{ flexShrink: 0 }}>
          Edit
        </Link>
      </div>

      {/* Companion + garden */}
      <div className="card" style={{ marginBottom: 22 }}>
        <h2 style={{ fontSize: 14.5, marginBottom: 14 }}>
          {companion?.name ?? "Sprout"}
        </h2>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
          <div className="companion-body" style={{ width: 64, height: 64 }}>
            <SparklesIcon cls="icon-lg" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, marginBottom: 6 }}>
              Growth from studying: <strong>{companion?.growth ?? 0}</strong>
            </div>
            {leafMatch && (
              <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>
                {progress.gardenXp} Garden XP to spend
              </div>
            )}
          </div>
        </div>
        {leafMatch && (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link to="/game" className="btn btn-primary" style={{ flex: 1, minWidth: 150 }}>
              <GamepadIcon cls="icon-sm" /> Play &amp; decorate
            </Link>
            <Link to="/shop" className="btn btn-ghost" style={{ flex: 1, minWidth: 150 }}>
              <ShoppingBagIcon cls="icon-sm" /> Shop
            </Link>
          </div>
        )}
      </div>

      {badges.length > 0 && (
        <>
          <Collapsible title={`Badges (${badges.length})`}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {badges.map((b) => (
                <span key={b.key} className="pill pill-green" title={b.description}>
                  <AwardIcon cls="icon-sm" /> {b.name}
                </span>
              ))}
            </div>
          </Collapsible>
          <div style={{ height: 14 }} />
        </>
      )}

      {/* Referrals (Step 14) — only once the first good moment has happened. */}
      {referral.promptUnlocked && (
        <div className="card" style={{ marginBottom: 22 }}>
          <h2 style={{ fontSize: 14.5, marginBottom: 6 }}>Invite a friend</h2>
          <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 14 }}>
            You both get Garden XP and a streak freeze once they finish their
            first quiz. {referral.invited} invited · {referral.rewarded} rewarded.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input
              readOnly
              value={referral.link}
              onFocus={(e) => e.currentTarget.select()}
              style={{
                flex: 1,
                minWidth: 200,
                fontFamily: "var(--font-mono)",
                fontSize: 12.5,
                padding: "12px 14px",
                borderRadius: "var(--r-sm)",
                border: "1.5px solid var(--border)",
                background: "var(--surface-alt)",
                color: "var(--ink)",
              }}
              aria-label="Your referral link"
            />
            <button className="btn btn-ghost" onClick={() => copyReferral(referral.link)}>
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
        </div>
      )}

      {/* Beta feedback — deliberately prominent during the beta. */}
      <div className="card" style={{ marginBottom: 22 }}>
        <h2 style={{ fontSize: 14.5, marginBottom: 6 }}>Send feedback</h2>
        <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 12 }}>
          Something confusing, broken, or missing? This goes straight to the
          team — it's the fastest way to shape what gets fixed.
        </p>
        <div className="field" style={{ marginBottom: 10 }}>
          <label htmlFor="p-feedback" className="sr-only">
            Your feedback
          </label>
          <textarea
            id="p-feedback"
            rows={3}
            value={feedbackDraft}
            onChange={(e) => setFeedbackDraft(e.target.value)}
            placeholder="What happened, and what did you expect?"
            maxLength={2000}
          />
        </div>
        <button
          className="btn btn-ghost btn-block"
          onClick={sendFeedback}
          disabled={feedbackBusy || feedbackDraft.trim().length < 3}
        >
          {feedbackBusy ? "Sending…" : "Send feedback"}
        </button>
      </div>

      {/* Subscription (Step 13) */}
      <div className="card" style={{ marginBottom: 22 }}>
        <h2 style={{ fontSize: 14.5, marginBottom: 10 }}>Plan</h2>
        <p style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 14 }}>
          {isPremium
            ? `Pathwise Pro (${subscription.interval})${
                subscription.cancelAtPeriodEnd
                  ? " — cancels at the end of the period"
                  : ""
              }`
            : "Free plan"}
        </p>
        <button className="btn btn-ghost btn-block" onClick={() => navigate("/upgrade")}>
          {isPremium ? "Manage plan" : "See Pathwise Pro"}
        </button>
      </div>

      {/* Password */}
      <Collapsible title="Change password">
        <div className="field">
          <label htmlFor="p-current">Current password</label>
          <input
            id="p-current"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="p-new">New password</label>
          <input
            id="p-new"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </div>
        <button className="btn btn-ghost btn-block" onClick={changePassword}>
          Update password
        </button>
      </Collapsible>

      <div style={{ height: 14 }} />

      {/* Data + deletion (Steps 10 and 15) */}
      <Collapsible title="Your data">
        <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 14 }}>
          Download everything we hold about you, or delete your account. Deletion
          keeps your data for 30 days in case you change your mind — sign back in
          within that window to restore it.
        </p>
        <button
          className="btn btn-ghost btn-block"
          onClick={exportData}
          style={{ marginBottom: 10 }}
        >
          Download my data
        </button>

        {!deleting ? (
          <button
            className="btn btn-ghost btn-block"
            style={{ color: "var(--danger)", borderColor: "var(--danger)" }}
            onClick={() => setDeleting(true)}
          >
            Delete my account
          </button>
        ) : (
          <>
            <div className="field">
              <label htmlFor="p-del">Confirm your password to delete</label>
              <input
                id="p-del"
                type="password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
              />
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                className="btn btn-ghost"
                style={{ flex: 1 }}
                onClick={() => {
                  setDeleting(false);
                  setDeletePassword("");
                }}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                style={{ flex: 1, background: "var(--danger)", boxShadow: "none" }}
                onClick={deleteAccount}
                disabled={deletePassword.length === 0}
              >
                Delete permanently
              </button>
            </div>
          </>
        )}
      </Collapsible>

      <div style={{ height: 18 }} />

      <button className="btn btn-ghost btn-block" onClick={logout}>
        Log out
      </button>
    </AppShell>
  );
}
