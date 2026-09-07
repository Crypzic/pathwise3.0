import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useFeatures } from "../lib/features";
import { ApiError } from "../lib/api";
import { LogoFull } from "../components/Logo";
import { PasswordField } from "../components/PasswordField";

export default function SignIn() {
  const { signin, continueAsGuest } = useAuth();
  const { guestMode } = useFeatures();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [guestBusy, setGuestBusy] = useState(false);

  async function onGuest() {
    setError(null);
    setGuestBusy(true);
    try {
      await continueAsGuest();
      // Guests see the privacy statement like everyone else.
      navigate("/privacy");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setGuestBusy(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signin(email, password);
      navigate("/courses");
    } catch (err) {
      // 401 always means "invalid email or password" from the backend — show
      // that generic message rather than exposing which one was wrong.
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={onSubmit}>
        <div style={{ marginBottom: 24, display: "flex", justifyContent: "center" }}>
          <LogoFull height={38} animated />
        </div>
        <h1 style={{ fontSize: 23, marginBottom: 6 }}>Welcome back</h1>
        <p style={{ color: "var(--ink-soft)", fontSize: 13.5, marginBottom: 26 }}>
          Pick up your streak where you left off.
        </p>

        {error && <div className="form-error">{error}</div>}

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

        <PasswordField
          label="Password"
          value={password}
          onChange={setPassword}
          placeholder="••••••••"
          autoComplete="current-password"
        />

        <div style={{ textAlign: "right", marginTop: -8, marginBottom: 16 }}>
          <Link
            to="/forgot-password"
            style={{ color: "var(--ink-soft)", fontSize: 12.5, fontWeight: 600 }}
          >
            Forgot password?
          </Link>
        </div>

        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>

        {guestMode && (
          <button
            type="button"
            className="btn btn-ghost btn-block"
            style={{ marginTop: 10 }}
            onClick={onGuest}
            disabled={guestBusy}
          >
            {guestBusy ? "Setting things up…" : "Continue as guest"}
          </button>
        )}

        <p
          style={{
            textAlign: "center",
            fontSize: 13,
            color: "var(--ink-soft)",
            marginTop: 22,
          }}
        >
          New here?{" "}
          <Link to="/signup" style={{ color: "var(--primary)", fontWeight: 700 }}>
            Create an account
          </Link>
        </p>
      </form>
    </div>
  );
}
