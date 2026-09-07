// Privacy statement — shown once, right after signup, before any upload.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { ShieldIcon, LockIcon, EyeOffIcon } from "../components/icons";
import { LogoMark } from "../components/Logo";

const points = [
  {
    Icon: LockIcon,
    title: "Your materials stay yours",
    body: "Uploaded syllabi and slides are only ever used to build your own study tools — never sold, never shared, never used to train anything.",
  },
  {
    Icon: ShieldIcon,
    title: "Your progress is private",
    body: "Mastery, quiz results, and study data belong to you alone. No leaderboards, no comparisons with other students.",
  },
  {
    Icon: EyeOffIcon,
    title: "We store only what we need",
    body: "You can delete your account anytime, with a 30-day recovery window in case you change your mind.",
  },
];

export default function Privacy() {
  const { acceptPrivacy, user } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  async function accept() {
    setBusy(true);
    try {
      await acceptPrivacy();
      // New learners flow into the onboarding wizard (Phase 2); anyone who
      // already finished (or skipped) it goes straight to their courses.
      navigate(user?.onboarded ? "/courses" : "/onboarding");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card" style={{ width: 440 }}>
        <div className="auth-mascot">
          <LogoMark size={40} variant="mono" style={{ color: "white" }} />
        </div>
        <h1 style={{ fontSize: 22, marginBottom: 6 }}>A quick promise</h1>
        <p style={{ color: "var(--ink-soft)", fontSize: 13.5, marginBottom: 24 }}>
          Before you upload anything, here's how Pathwise treats your data.
        </p>

        {points.map(({ Icon, title, body }) => (
          <div className="privacy-point" key={title}>
            <div className="dot">
              <Icon cls="icon" />
            </div>
            <div className="txt">
              <strong>{title}</strong>
              <span>{body}</span>
            </div>
          </div>
        ))}

        <button
          className="btn btn-primary btn-block"
          style={{ marginTop: 10 }}
          onClick={accept}
          disabled={busy}
        >
          {busy ? "One moment…" : "Got it — let's go"}
        </button>
      </div>
    </div>
  );
}
