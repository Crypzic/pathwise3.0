// Picks the AI provider based on env.
//
// Import the metered wrappers in lib/aiMeter.ts rather than this `ai` object
// directly — that's what records token spend. This module is the raw provider.
import { env } from "../lib/env.js";
import { MockAIProvider } from "./mock.js";
import { OpenAIProvider } from "./openai.js";
import { GeminiProvider } from "./gemini.js";
function createProvider() {
    if (env.AI_PROVIDER === "openai") {
        if (!env.OPENAI_API_KEY) {
            console.warn("⚠️  AI_PROVIDER=openai but OPENAI_API_KEY is empty — falling back to mock.");
            return new MockAIProvider();
        }
        return new OpenAIProvider();
    }
    if (env.AI_PROVIDER === "gemini") {
        if (!env.GEMINI_API_KEY) {
            console.warn("⚠️  AI_PROVIDER=gemini but GEMINI_API_KEY is empty — falling back to mock.");
            return new MockAIProvider();
        }
        return new GeminiProvider();
    }
    return new MockAIProvider();
}
export const ai = createProvider();
