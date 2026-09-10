// AI transport resilience — pure rules, unit-tested.
//
// Real providers fail in two transient ways: the model is overloaded
// (429/5xx — Google's "high demand" 503s hit us on launch-day models) and
// the network blips (fetch throws before any HTTP status exists). Both
// deserve retries with backoff before anyone sees an error; only after
// exhaustion do we surface a typed, friendly failure the routes can map
// to a 503 instead of a generic 500.

/** Statuses worth retrying: rate limits and server-side overload. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 504);
}

/** Exponential backoff: 800ms, 2400ms, 7200ms… capped at 10s. */
export function backoffMs(attempt: number): number {
  return Math.min(800 * Math.pow(3, attempt), 10_000);
}

export const MAX_ATTEMPTS = 3;

/**
 * Raised when the provider stayed unreachable/overloaded through every
 * retry. The message is user-facing — routes return it with a 503.
 */
export class AIUnavailableError extends Error {
  constructor(detail?: string) {
    super(
      "The AI service is briefly unavailable — please try again in a moment."
    );
    this.name = "AIUnavailableError";
    if (detail) this.cause = detail;
  }
}
