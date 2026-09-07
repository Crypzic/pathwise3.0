import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { ApiError } from "../lib/api";
import { LogoFull } from "../components/Logo";
import { PasswordField } from "../components/PasswordField";

export default function SignUp() {
  const { signup, claimAccount, user } = useAuth();
  const navigate = useNavigate();
  // A guest landing here isn't signing up fresh — they're claiming their
  // session, keeping every course, quiz and streak (Phase 1).
  const claiming = Boolean(user?.isGuest);
  // Referral links land here as /signup?ref=CODE (Step 14). The code is passed
  // through to signup and recorded as pending — nothing pays out until the new
  // user reaches their first real milestone.
  const [params] = useSearchParams();
  const referralCode = params.get("ref") ?? undefined;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
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
      if (claiming) {
        await claimAccount(name, email, password, referralCode);
        // A guest already accepted the privacy statement.
        navigate("/courses");
      } else {
        await signup(name, email, password, referralCode);
        // New users always see the privacy statement next (shown once).
        navigate("/privacy");
      }
    } catch (err) {
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
        <h1 style={{ fontSize: 23, marginBottom: 6 }}>
          {claiming ? "Keep everything you've done" : "Start learning better"}
        </h1>
        <p style={{ color: "var(--ink-soft)", fontSize: 13.5, marginBottom: 26 }}>
          {claiming
            ? "Your courses, quizzes and streak come with you — this just makes them permanent."
            : "Understand your courses — not just cram them."}
        </p>

        {error && <div className="form-error" role="alert">{error}</div>}

        {referralCode && (
          <div className="form-notice">
            You were invited — you'll both get a reward after your first quiz.
          </div>
        )}

        <div className="field">
          <label>Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ada Lovelace"
            autoComplete="name"
            required
          />
        </div>
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
          placeholder="At least 8 characters"
          autoComplete="new-password"
        />

        <PasswordField
          label="Confirm password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          placeholder="Type it again"
          autoComplete="new-password"
          error={confirmError ?? undefined}
        />

        <button
          className="btn btn-primary btn-block"
          style={{ marginTop: 6 }}
          disabled={busy}
        >
          {busy
            ? claiming
              ? "Saving your progress…"
              : "Creating account…"
            : claiming
              ? "Create account & keep progress"
              : "Create account"}
        </button>

        <p
          style={{
            textAlign: "center",
            fontSize: 13,
            color: "var(--ink-soft)",
            marginTop: 22,
          }}
        >
          Already have an account?{" "}
          <Link to="/signin" style={{ color: "var(--primary)", fontWeight: 700 }}>
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
