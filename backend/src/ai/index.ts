// Picks AI providers based on env — including per-task routing.
//
// Import the metered wrappers in lib/aiMeter.ts rather than these objects
// directly — that's what records token spend. This module is the raw layer:
// one lazily-created instance per configured provider, and a router that
// maps each operation group (tutor / quiz / moderation / extract) to its
// provider, falling back to the global AI_PROVIDER.
import { env } from "../lib/env.js";
import type { AIProvider } from "./types.js";
import { MockAIProvider } from "./mock.js";
import { OpenAIProvider } from "./openai.js";
import { GeminiProvider } from "./gemini.js";
import { ClaudeProvider } from "./claude.js";
import { GrokProvider } from "./grok.js";
import { routeGroupFor, type AIOperationName } from "./routing.js";

export type ProviderName = "mock" | "openai" | "gemini" | "claude" | "grok";

function hasKey(name: ProviderName): boolean {
  switch (name) {
    case "openai":
      return env.OPENAI_API_KEY.length > 0;
    case "gemini":
      return env.GEMINI_API_KEY.length > 0;
    case "claude":
      return env.ANTHROPIC_API_KEY.length > 0;
    case "grok":
      return env.XAI_API_KEY.length > 0;
    case "mock":
      return true;
  }
}

function construct(name: ProviderName): AIProvider {
  switch (name) {
    case "openai":
      return new OpenAIProvider();
    case "gemini":
      return new GeminiProvider();
    case "claude":
      return new ClaudeProvider();
    case "grok":
      return new GrokProvider();
    case "mock":
      return new MockAIProvider();
  }
}

// One instance per provider, created on first use.
const instances = new Map<ProviderName, AIProvider>();
function instanceOf(name: ProviderName): AIProvider {
  let p = instances.get(name);
  if (!p) {
    p = construct(name);
    instances.set(name, p);
  }
  return p;
}

/** The global default provider (falls back to mock when its key is missing). */
function defaultName(): ProviderName {
  const name = env.AI_PROVIDER as ProviderName;
  if (!hasKey(name)) {
    if (name !== "mock") {
      console.warn(
        `⚠️  AI_PROVIDER=${name} but its API key is empty — falling back to mock.`
      );
    }
    return "mock";
  }
  return name;
}

const routeOverrides: Record<string, string> = {
  tutor: env.AI_PROVIDER_TUTOR,
  quiz: env.AI_PROVIDER_QUIZ,
  moderation: env.AI_PROVIDER_MODERATION,
  extract: env.AI_PROVIDER_EXTRACT,
};

/**
 * The provider that should handle one operation. A route override with a
 * missing key falls back to the DEFAULT provider (never silently to mock) —
 * a misconfigured route must not degrade a real deployment to placeholders.
 */
export function providerFor(operation: AIOperationName): AIProvider {
  const group = routeGroupFor(operation);
  const override = routeOverrides[group] as ProviderName | "";
  if (override && override.length > 0) {
    if (hasKey(override)) return instanceOf(override);
    console.warn(
      `⚠️  AI route '${group}' is set to '${override}' but its API key is empty — using the default provider.`
    );
  }
  return instanceOf(defaultName());
}

/** Routing summary for /api/health and boot logs. */
export function routingSummary(): Record<string, string> {
  const def = defaultName();
  const resolve = (override: string) =>
    override && hasKey(override as ProviderName) ? override : def;
  return {
    default: def,
    tutor: resolve(env.AI_PROVIDER_TUTOR),
    quiz: resolve(env.AI_PROVIDER_QUIZ),
    moderation: resolve(env.AI_PROVIDER_MODERATION),
    extract: resolve(env.AI_PROVIDER_EXTRACT),
  };
}

/** The default provider — kept for scripts and name display. */
export const ai: AIProvider = instanceOf(defaultName());

export type {
  AIProvider,
  AIResult,
  ChatMessage,
  ExtractedTopic,
  MaterialVerdict,
  QuizQuestion,
  TokenUsage,
} from "./types.js";
