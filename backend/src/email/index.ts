// Picks the email provider based on env. Import `email` anywhere you need to
// send mail. Mirrors the ai/index.ts pattern exactly.
import { env } from "../lib/env.js";
import type { EmailProvider } from "./types.js";
import { MockEmailProvider } from "./mock.js";
import { ResendEmailProvider } from "./resend.js";

function createProvider(): EmailProvider {
  if (env.EMAIL_PROVIDER === "resend") {
    if (!env.RESEND_API_KEY) {
      console.warn(
        "⚠️  EMAIL_PROVIDER=resend but RESEND_API_KEY is empty — falling back to mock."
      );
      return new MockEmailProvider();
    }
    return new ResendEmailProvider();
  }
  return new MockEmailProvider();
}

export const email: EmailProvider = createProvider();
export type { EmailProvider } from "./types.js";
