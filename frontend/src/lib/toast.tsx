// Lightweight toasts for gamification feedback (Step 9): XP gained, rank up,
// badge unlocked. Deliberately transient and non-blocking — the reward should
// never interrupt the study flow.
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

export interface Toast {
  id: number;
  title: string;
  body?: string;
  icon?: ReactNode;
}

interface ToastState {
  toasts: Toast[];
  push: (toast: Omit<Toast, "id">) => void;
}

const ToastContext = createContext<ToastState | null>(null);

const VISIBLE_MS = 3600;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const push = useCallback((toast: Omit<Toast, "id">) => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, VISIBLE_MS);
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, push }}>
      {children}
      {/* Announced politely so a screen reader mentions the reward without
          interrupting whatever the student is reading. */}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            {t.icon}
            <div>
              <div className="t-title">{t.title}</div>
              {t.body && <div className="t-body">{t.body}</div>}
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastState {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

/** Shared shape returned by any endpoint that can award things. */
export interface RewardPayload {
  xp?: { gained: number; total: number; rank: { level: number; name: string }; rankedUp?: boolean };
  newBadges?: { key: string; name: string; description: string }[];
}

/** Turn an API reward payload into toasts. Used by quiz, Socratic and shop. */
export function useRewardToasts() {
  const { push } = useToast();
  return useCallback(
    (payload: RewardPayload) => {
      if (payload.xp?.rankedUp) {
        push({
          title: `New rank: ${payload.xp.rank.name}`,
          body: `You're now level ${payload.xp.rank.level}.`,
        });
      }
      for (const badge of payload.newBadges ?? []) {
        push({ title: `Badge unlocked: ${badge.name}`, body: badge.description });
      }
    },
    [push]
  );
}
