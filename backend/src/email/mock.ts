// Free, default provider — just logs to the console instead of sending real
// email. This lets anyone develop the forgot-password flow with zero setup
// and zero cost. Copy the printed link straight into your browser.
import type { EmailProvider, NotificationEmail } from "./types.js";

export class MockEmailProvider implements EmailProvider {
  readonly name = "mock";

  async sendPasswordReset(to: string, resetUrl: string): Promise<void> {
    console.log("\n📧  [mock email] Password reset requested");
    console.log(`    To: ${to}`);
    console.log(`    Link: ${resetUrl}\n`);
  }

  async sendNotification(mail: NotificationEmail): Promise<void> {
    console.log("\n📧  [mock email] Notification");
    console.log(`    To: ${mail.to}`);
    console.log(`    Subject: ${mail.subject}`);
    console.log(`    ${mail.body}`);
    console.log(`    [${mail.actionLabel}] ${mail.actionUrl}\n`);
  }
}
