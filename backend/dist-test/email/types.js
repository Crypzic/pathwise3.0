// The email provider interface. Every feature that sends email goes through
// this, so we can run entirely for free in development (mock) and swap in
// a real sender (Resend) with just an env var — same pattern as ai/types.ts.
export {};
