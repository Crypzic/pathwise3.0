export class MockEmailProvider {
    name = "mock";
    async sendPasswordReset(to, resetUrl) {
        console.log("\n📧  [mock email] Password reset requested");
        console.log(`    To: ${to}`);
        console.log(`    Link: ${resetUrl}\n`);
    }
    async sendNotification(mail) {
        console.log("\n📧  [mock email] Notification");
        console.log(`    To: ${mail.to}`);
        console.log(`    Subject: ${mail.subject}`);
        console.log(`    ${mail.body}`);
        console.log(`    [${mail.actionLabel}] ${mail.actionUrl}\n`);
    }
}
