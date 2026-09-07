// The email provider interface. Every feature that sends email goes through
// this, so we can run entirely for free in development (mock) and swap in
// a real sender (Resend) with just an env var — same pattern as ai/types.ts.

export interface NotificationEmail {
  to: string;
  subject: string;
  /** One short paragraph of body text (plain language, no markup). */
  body: string;
  /** Absolute URL the button points at. */
  actionUrl: string;
  /** Button label, e.g. "Open Pathwise". */
  actionLabel: string;
}

export interface EmailProvider {
  readonly name: string;

  /** Sends a password-reset link. Providers must not throw on user-not-found —
   *  that check happens before this is called; this only ever sends mail. */
  sendPasswordReset(to: string, resetUrl: string): Promise<void>;

  /**
   * Sends a notification email (Step 12 — streak/review reminders by email,
   * the channel that can actually bring someone back into the app).
   */
  sendNotification(mail: NotificationEmail): Promise<void>;
}
