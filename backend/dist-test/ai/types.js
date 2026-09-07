// The AI provider interface. Every feature that needs AI goes through this,
// so we can swap "mock" <-> "openai" (or add Claude later) in one place.
//
// Every method returns its token usage alongside the result. Cost metering
// (lib/aiMeter.ts) depends on that being reported per call, not tracked in a
// module-level global — concurrent requests would corrupt a shared counter.
export {};
