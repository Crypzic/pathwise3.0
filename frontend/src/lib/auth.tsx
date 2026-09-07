// Auth context — talks to the real backend.
//
// The token lives in localStorage and is attached by lib/api.ts. On mount we
// call /api/auth/me to restore the session, so a stale or revoked token is
// discovered immediately rather than on the first real action.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  api,
  clearToken,
  getToken,
  setToken,
  UNAUTHORIZED_EVENT,
} from "./api";

export interface User {
  id: string;
  name: string;
  email: string;
  username: string | null;
  privacyAccepted: boolean;
  xp: number;
  streakCount: number;
  bestStreak: number;
  rank: { level: number; name: string; progress: number; nextXp: number | null };
  socraticIntroSeen: boolean;
  isPremium: boolean;
  // Guest mode (PATHWISE 2.0 Phase 1).
  isGuest: boolean;
  guestDaysLeft: number | null;
  // Whether the onboarding wizard was finished or skipped (Phase 2).
  onboarded: boolean;
}

interface AuthResponse {
  token: string;
  user: User;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  signup: (
    name: string,
    email: string,
    password: string,
    referralCode?: string
  ) => Promise<void>;
  signin: (email: string, password: string) => Promise<void>;
  /** Start a guest session — the core loop with no account (Phase 1). */
  continueAsGuest: () => Promise<void>;
  /** Convert the current guest into a real account, keeping all progress. */
  claimAccount: (
    name: string,
    email: string,
    password: string,
    referralCode?: string
  ) => Promise<void>;
  acceptPrivacy: () => Promise<void>;
  logout: () => void;
  forgotPassword: (email: string) => Promise<void>;
  resetPassword: (token: string, newPassword: string) => Promise<void>;
  /** Re-read the user — call after anything that changes XP, rank or tier. */
  refresh: () => Promise<void>;
  /** Local patch, so XP/streak chips update without a round trip. */
  patchUser: (patch: Partial<User>) => void;
}

const AuthContext = createContext<AuthState | null>(null);

// The browser's own timezone is the right default for streak boundaries.
function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      return;
    }
    try {
      const { user: fresh } = await api.get<{ user: User }>("/api/auth/me");
      setUser(fresh);
    } catch {
      // A token we can't exchange for a user is worthless — drop it.
      logout();
    }
  }, [logout]);

  useEffect(() => {
    void refresh().finally(() => setLoading(false));
  }, [refresh]);

  // Any 401 from anywhere in the app ends the session.
  useEffect(() => {
    const onUnauthorized = () => logout();
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [logout]);

  async function signup(
    name: string,
    email: string,
    password: string,
    referralCode?: string
  ) {
    const res = await api.post<AuthResponse>("/api/auth/signup", {
      name,
      email,
      password,
      timezone: localTimezone(),
      referralCode: referralCode || undefined,
    });
    setToken(res.token);
    setUser(res.user);
  }

  async function signin(email: string, password: string) {
    const res = await api.post<AuthResponse>("/api/auth/signin", {
      email,
      password,
    });
    setToken(res.token);
    setUser(res.user);
  }

  async function continueAsGuest() {
    const res = await api.post<AuthResponse>("/api/auth/guest", {
      timezone: localTimezone(),
    });
    setToken(res.token);
    setUser(res.user);
  }

  async function claimAccount(
    name: string,
    email: string,
    password: string,
    referralCode?: string
  ) {
    const res = await api.post<AuthResponse>("/api/auth/claim", {
      name,
      email,
      password,
      timezone: localTimezone(),
      referralCode: referralCode || undefined,
    });
    // The claim re-signs the token — the old one carries the guest identity.
    setToken(res.token);
    setUser(res.user);
  }

  async function acceptPrivacy() {
    const res = await api.post<{ user: User }>("/api/auth/accept-privacy");
    setUser(res.user);
  }

  async function forgotPassword(email: string) {
    await api.post("/api/auth/forgot-password", { email });
  }

  async function resetPassword(token: string, newPassword: string) {
    await api.post("/api/auth/reset-password", { token, newPassword });
  }

  function patchUser(patch: Partial<User>) {
    setUser((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        signup,
        signin,
        continueAsGuest,
        claimAccount,
        acceptPrivacy,
        logout,
        forgotPassword,
        resetPassword,
        refresh,
        patchUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
