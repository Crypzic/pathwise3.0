// Per-user overflow menu (⋯): Block and Report, the safety actions every
// social surface offers. One component so buddies, matches and future
// surfaces all behave identically (Isaac's UX review, item 7).
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { MoreIcon } from "./icons";

const REPORT_REASONS: { key: string; label: string }[] = [
  { key: "harassment", label: "Harassment" },
  { key: "abuse", label: "Abuse" },
  { key: "spam", label: "Spam" },
  { key: "inappropriate", label: "Inappropriate behavior" },
  { key: "other", label: "Other" },
];

export function UserActions({
  userId,
  name,
  onNotice,
  onError,
  onBlocked,
}: {
  userId: string;
  name: string;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
  /** Called after a successful block so the parent can drop the row. */
  onBlocked?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"menu" | "report">("menu");
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function block() {
    setOpen(false);
    if (
      !window.confirm(
        `Block ${name}? Neither of you will be able to message the other, and you'll disappear from each other's matches. You can unblock later from your profile.`
      )
    ) {
      return;
    }
    try {
      await api.post("/api/dms/block", { userId, on: true });
      onNotice(`${name} is blocked. You can unblock from your profile.`);
      onBlocked?.();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Couldn't block just now.");
    }
  }

  async function report(reason: string) {
    setOpen(false);
    setMode("menu");
    try {
      const res = await api.post<{ message: string }>(
        `/api/users/${userId}/report`,
        { reason }
      );
      onNotice(res.message);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Couldn't send the report.");
    }
  }

  return (
    <div className="user-menu-wrap" ref={wrapRef}>
      <button
        className="icon-btn"
        aria-label={`More actions for ${name}`}
        aria-expanded={open}
        onClick={() => {
          setMode("menu");
          setOpen((o) => !o);
        }}
      >
        <MoreIcon cls="icon-sm" />
      </button>
      {open && (
        <div className="user-menu" role="menu">
          {mode === "menu" ? (
            <>
              <button role="menuitem" onClick={() => setMode("report")}>
                Report {name}
              </button>
              <button role="menuitem" className="danger" onClick={block}>
                Block {name}
              </button>
            </>
          ) : (
            <>
              <div className="menu-note">Report for…</div>
              {REPORT_REASONS.map((r) => (
                <button key={r.key} role="menuitem" onClick={() => report(r.key)}>
                  {r.label}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
