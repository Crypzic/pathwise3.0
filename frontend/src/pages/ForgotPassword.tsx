import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { LogoMark } from "../components/Logo";

export default function ForgotPassword() {
  const { forgotPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await forgotPassword(email);
    } finally {
      // Always show the confirmation state, even on error — the backend's
      // response is intentionally generic, so the frontend shouldn't leak
      // more information than that either.
      setBusy(false);
      setSent(true);
    }
  }

  if (sent) {
    return (
      <div className="auth-wrap">
        <div className="auth-card" style={{ textAlign: "center" }}>
          <div className="auth-mascot" style={{ margin: "0 auto 18px auto" }}>
            <LogoMark size={40} variant="mono" style={{ color: "white" }} />
          </div>
          <h1 style={{ fontSize: 21, marginBottom: 10 }}>Check your email</h1>
          <p style={{ color: "var(--ink-soft)", fontSize: 13.5, marginBottom: 22 }}>
            If an account exists for <strong>{email}</strong>, we've sent a
            link to reset your password. It expires in 1 hour.
          </p>
          <Link to="/signin" className="btn btn-ghost btn-block">
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={onSubmit}>
        <div className="auth-mascot">
          <LogoMark size={40} variant="mono" style={{ color: "white" }} />
        </div>
        <h1 style={{ fontSize: 21, marginBottom: 6 }}>Reset your password</h1>
        <p style={{ color: "var(--ink-soft)", fontSize: 13.5, marginBottom: 24 }}>
          Enter your email and we'll send you a link to set a new one.
        </p>

        <div className="field">
          <label>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            required
          />
        </div>

        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "Sending…" : "Send reset link"}
        </button>

        <p
          style={{
            textAlign: "center",
            fontSize: 13,
            color: "var(--ink-soft)",
            marginTop: 22,
          }}
        >
          <Link to="/signin" style={{ color: "var(--primary)", fontWeight: 700 }}>
            Back to sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
