import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { ApiError } from "../lib/api";
import { LogoMark } from "../components/Logo";
import { PasswordField } from "../components/PasswordField";

export default function ResetPassword() {
  const { resetPassword } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setConfirmError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setConfirmError("Passwords don't match.");
      return;
    }

    setBusy(true);
    try {
      await resetPassword(token, password);
      setDone(true);
      setTimeout(() => navigate("/signin"), 2000);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Something went wrong. Try requesting a new link."
      );
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="auth-wrap">
        <div className="auth-card" style={{ textAlign: "center" }}>
          <h1 style={{ fontSize: 21, marginBottom: 10 }}>Password updated</h1>
          <p style={{ color: "var(--ink-soft)", fontSize: 13.5 }}>
            Redirecting you to sign in…
          </p>
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
        <h1 style={{ fontSize: 21, marginBottom: 6 }}>Set a new password</h1>
        <p style={{ color: "var(--ink-soft)", fontSize: 13.5, marginBottom: 24 }}>
          Choose something you haven't used before.
        </p>

        {error && <div className="form-error">{error}</div>}

        <PasswordField
          label="New password"
          value={password}
          onChange={setPassword}
          placeholder="At least 8 characters"
          autoComplete="new-password"
        />
        <PasswordField
          label="Confirm new password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          placeholder="Type it again"
          autoComplete="new-password"
          error={confirmError ?? undefined}
        />

        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "Updating…" : "Update password"}
        </button>
      </form>
    </div>
  );
}
