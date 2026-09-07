// Loading / error / empty states (Step 16 item 1).
//
// Shared so every screen fails the same way. The skeleton variants exist so a
// slow page shows its shape rather than a spinner in an empty void.
import type { ReactNode } from "react";
import { AlertIcon } from "./icons";

/** Screen-reader-announced busy region. */
export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{ padding: "40px 0", textAlign: "center", color: "var(--ink-soft)", fontSize: 13.5 }}
    >
      {label}
    </div>
  );
}

/** Grey blocks matching a card list's shape. */
export function SkeletonRows({ rows = 3, height = 64 }: { rows?: number; height?: number }) {
  return (
    <div role="status" aria-live="polite" aria-label="Loading" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height }} />
      ))}
    </div>
  );
}

export function SkeletonGrid({ cards = 3 }: { cards?: number }) {
  return (
    <div className="courses-grid" role="status" aria-live="polite" aria-label="Loading">
      {Array.from({ length: cards }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height: 168, borderRadius: "var(--r-xl)" }} />
      ))}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="empty-state" role="alert">
      <div className="icon-circle" style={{ background: "var(--danger-light)", color: "#8A2B2B" }}>
        <AlertIcon cls="icon-lg" />
      </div>
      <h2 style={{ fontSize: 16, marginBottom: 6 }}>That didn't load</h2>
      <p style={{ color: "var(--ink-soft)", fontSize: 13.5, marginBottom: 18 }}>{message}</p>
      {onRetry && (
        <button className="btn btn-ghost" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="icon-circle">{icon}</div>
      <h2 style={{ fontSize: 16, marginBottom: 6 }}>{title}</h2>
      <p style={{ color: "var(--ink-soft)", fontSize: 13.5, marginBottom: 18, maxWidth: 420, margin: "0 auto 18px auto" }}>
        {body}
      </p>
      {action}
    </div>
  );
}

/** Inline banner for an action that failed without losing the page. */
export function InlineError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="form-error" role="alert">
      {message}
    </div>
  );
}

/** Inline success/confirmation banner. */
export function InlineNotice({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="form-notice" role="status">
      {message}
    </div>
  );
}
