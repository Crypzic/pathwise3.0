import { env } from "../lib/env.js";
// Basic entity escaping — notification bodies include user-derived strings
// (course names), and those must never become live HTML in someone's inbox.
function escapeHtml(s) {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
export class ResendEmailProvider {
    name = "resend";
    async send(to, subject, html) {
        const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${env.RESEND_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ from: env.EMAIL_FROM, to, subject, html }),
        });
        if (!res.ok) {
            const body = await res.text();
            throw new Error(`Resend API error (${res.status}): ${body}`);
        }
    }
    async sendPasswordReset(to, resetUrl) {
        await this.send(to, "Reset your Pathwise password", `
        <p>Someone requested a password reset for this email.</p>
        <p><a href="${resetUrl}">Click here to set a new password</a> — this link expires in 1 hour.</p>
        <p>If you didn't request this, you can safely ignore this email.</p>
      `);
    }
    async sendNotification(mail) {
        // Deliberately plain: one sentence and one button reads as a nudge from a
        // study app, not a marketing campaign — and survives every mail client.
        await this.send(mail.to, mail.subject, `
        <p style="font-size:15px;line-height:1.6;color:#10201A;">${escapeHtml(mail.body)}</p>
        <p style="margin:24px 0;">
          <a href="${mail.actionUrl}"
             style="background:#0E7A55;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:bold;display:inline-block;">
            ${escapeHtml(mail.actionLabel)}
          </a>
        </p>
        <p style="font-size:12px;color:#5B6B62;">
          You can turn these reminders off in your Pathwise profile settings.
        </p>
      `);
    }
}
