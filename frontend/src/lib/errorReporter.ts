// Global error reporter (beta readiness). Testers report crashes; mostly
// they just leave — this makes failures visible in /api/ops/errors without
// a third-party service. Throttled hard: at most a handful of reports per
// session, fire-and-forget, and never able to throw itself.
const API_BASE = import.meta.env.VITE_API_URL ?? "";
const MAX_REPORTS_PER_SESSION = 5;
let sent = 0;

function report(message: string, stack?: string) {
  if (sent >= MAX_REPORTS_PER_SESSION) return;
  sent += 1;
  try {
    void fetch(`${API_BASE}/api/client-errors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: String(message).slice(0, 500),
        stack: stack?.slice(0, 4000),
        url: window.location.pathname,
      }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Reporting must never cause its own error loop.
  }
}

export function installErrorReporter(): void {
  window.addEventListener("error", (event) => {
    report(
      event.message || "Unknown window error",
      event.error instanceof Error ? event.error.stack : undefined
    );
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason: unknown = event.reason;
    if (reason instanceof Error) {
      report(`Unhandled rejection: ${reason.message}`, reason.stack);
    } else {
      report(`Unhandled rejection: ${String(reason).slice(0, 300)}`);
    }
  });
}
