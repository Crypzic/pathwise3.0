// Gemini provider (PATHWISE 2.0 Phase 3) — the testing-phase primary.
// Only used when AI_PROVIDER=gemini and GEMINI_API_KEY is set.
//
// Talks to the Generative Language REST API directly with fetch — no SDK
// dependency. Prompts and response validation live in ./prompts.ts, shared
// with every real provider; application logic never sees which provider
// answered (the roadmap's "do not hardwire Gemini" rule).
import type {
  AIProvider,
  AIResult,
  ChatMessage,
  ExtractedTopic,
  ImageInput,
  MaterialVerdict,
  QuizQuestion,
  QuizTopicInput,
  SocraticContext,
  TokenUsage,
  TopicBreakdown,
  WrittenGrade,
  WrittenQuestion,
} from "./types.js";
import {
  askSystemPrompt,
  classifyMaterialPrompt,
  communityTopicPrompt,
  explainTopicPrompt,
  extractTopicsPrompt,
  generateQuizPrompt,
  gradeWrittenPrompt,
  SOCRATIC_FALLBACK,
  socraticSystemPrompt,
  transcribeImagePrompt,
  validateBreakdown,
  validateCommunityVerdict,
  validateGrade,
  validateQuestions,
  validateTopics,
  validateVerdict,
  validateVideoQuery,
  validateWrittenQuestions,
  videoQueryPrompt,
  writtenQuestionsPrompt,
} from "./prompts.js";
import { env } from "../lib/env.js";
import {
  AIUnavailableError,
  backoffMs,
  isRetryableStatus,
  MAX_ATTEMPTS,
} from "./resilience.js";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const REQUEST_TIMEOUT_MS = 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
  error?: { code?: number; message?: string; status?: string };
}

export class GeminiProvider implements AIProvider {
  readonly name = "gemini";
  private model: string;

  constructor() {
    this.model = env.GEMINI_MODEL;
  }

  /** One raw request against one model. Throws on any failure. */
  private async requestOnce(
    model: string,
    system: string,
    contents: {
      role: "user" | "model";
      parts: (
        | { text: string }
        | { inlineData: { mimeType: string; data: string } }
      )[];
    }[],
    jsonMode: boolean
  ): Promise<{ text: string; usage: TokenUsage }> {
    const url = `${API_BASE}/models/${model}:generateContent`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Key goes in a header, not the URL — URLs end up in logs.
        "x-goog-api-key": env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        generationConfig: jsonMode
          ? { responseMimeType: "application/json" }
          : {},
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const data = (await res.json().catch(() => ({}))) as GeminiResponse;
    if (!res.ok) {
      const err = new Error(
        `Gemini ${res.status}: ${data.error?.message ?? res.statusText}`
      ) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }

    const text =
      data.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? "")
        .join("") ?? "";
    return {
      text,
      usage: {
        model,
        promptTokens: data.usageMetadata?.promptTokenCount ?? 0,
        completionTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  }

  /**
   * Resilient generate: retries transient failures (429/5xx overload and
   * network errors — launch-day models 503 under "high demand" spikes and
   * hotspot connections blip) with exponential backoff; after the primary
   * model's retries are exhausted, tries GEMINI_FALLBACK_MODEL once; only
   * then raises a typed, user-friendly AIUnavailableError. Non-transient
   * errors (400 bad key, 404 bad model) throw immediately.
   */
  private async generate(
    system: string,
    contents: Parameters<GeminiProvider["requestOnce"]>[2],
    jsonMode: boolean
  ): Promise<{ text: string; usage: TokenUsage }> {
    let lastDetail = "";
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        return await this.requestOnce(this.model, system, contents, jsonMode);
      } catch (err) {
        const status = (err as { status?: number }).status;
        const transient = status === undefined || isRetryableStatus(status);
        if (!transient) throw err;
        lastDetail = err instanceof Error ? err.message : String(err);
        if (attempt < MAX_ATTEMPTS - 1) await sleep(backoffMs(attempt));
      }
    }

    // Primary model stayed down — one shot on the fallback model.
    const fallback = env.GEMINI_FALLBACK_MODEL;
    if (fallback && fallback !== this.model) {
      try {
        console.warn(
          `⚠️  ${this.model} unavailable (${lastDetail.slice(0, 80)}) — trying ${fallback}.`
        );
        return await this.requestOnce(fallback, system, contents, jsonMode);
      } catch (err) {
        lastDetail = err instanceof Error ? err.message : String(err);
      }
    }

    throw new AIUnavailableError(lastDetail);
  }

  private async json<T>(
    system: string,
    user: string
  ): Promise<{ parsed: T; usage: TokenUsage }> {
    const { text, usage } = await this.generate(
      system,
      [{ role: "user", parts: [{ text: user }] }],
      true
    );
    let parsed: T;
    try {
      parsed = JSON.parse(text) as T;
    } catch {
      // A malformed response shouldn't 500 the request — callers handle empty.
      parsed = {} as T;
    }
    return { parsed, usage };
  }

  async extractTopics(
    courseName: string,
    materialText: string
  ): Promise<AIResult<ExtractedTopic[]>> {
    const { system, user } = extractTopicsPrompt(courseName, materialText);
    const { parsed, usage } = await this.json<{ topics: ExtractedTopic[] }>(
      system,
      user
    );
    return { value: validateTopics(parsed), usage };
  }

  async generateQuiz(
    courseName: string,
    topics: QuizTopicInput[],
    count: number
  ): Promise<AIResult<QuizQuestion[]>> {
    const { system, user } = generateQuizPrompt(courseName, topics, count);
    const { parsed, usage } = await this.json<{ questions: QuizQuestion[] }>(
      system,
      user
    );
    return { value: validateQuestions(parsed), usage };
  }

  async socraticReply(
    courseName: string,
    topicName: string | null,
    history: ChatMessage[],
    ctx?: SocraticContext
  ): Promise<AIResult<string>> {
    // Gemini's chat roles are "user" | "model"; ours are "user" | "assistant".
    const contents = history.map((m) => ({
      role: m.role === "assistant" ? ("model" as const) : ("user" as const),
      parts: [{ text: m.content }],
    }));
    const { text, usage } = await this.generate(
      socraticSystemPrompt(courseName, topicName, ctx),
      contents,
      false
    );
    return { value: text.trim() || SOCRATIC_FALLBACK, usage };
  }

  async classifyMaterial(
    courseName: string,
    materialText: string
  ): Promise<AIResult<MaterialVerdict>> {
    const { system, user } = classifyMaterialPrompt(courseName, materialText);
    const { parsed, usage } = await this.json<Partial<MaterialVerdict>>(
      system,
      user
    );
    return { value: validateVerdict(parsed), usage };
  }

  async explainTopic(
    courseName: string,
    topicName: string,
    conceptContext: string,
    materialText: string
  ): Promise<AIResult<TopicBreakdown | null>> {
    const { system, user } = explainTopicPrompt(
      courseName,
      topicName,
      conceptContext,
      materialText
    );
    const { parsed, usage } = await this.json<Record<string, unknown>>(
      system,
      user
    );
    return { value: validateBreakdown(parsed), usage };
  }

  async askReply(
    courseName: string,
    topicName: string,
    history: ChatMessage[],
    grounding: string
  ): Promise<AIResult<string>> {
    const contents = history.map((m) => ({
      role: m.role === "assistant" ? ("model" as const) : ("user" as const),
      parts: [{ text: m.content }],
    }));
    const { text, usage } = await this.generate(
      askSystemPrompt(courseName, topicName, grounding),
      contents,
      false
    );
    return {
      value: text.trim() || "Could you ask that again in different words?",
      usage,
    };
  }

  async generateWrittenQuestions(
    courseName: string,
    topics: QuizTopicInput[],
    count: number
  ): Promise<AIResult<WrittenQuestion[]>> {
    const { system, user } = writtenQuestionsPrompt(courseName, topics, count);
    const { parsed, usage } = await this.json<{ questions: unknown }>(
      system,
      user
    );
    return { value: validateWrittenQuestions(parsed), usage };
  }

  async classifyCommunityTopic(
    name: string,
    description: string
  ): Promise<AIResult<{ educational: boolean; reason: string }>> {
    const { system, user } = communityTopicPrompt(name, description);
    const { parsed, usage } = await this.json<Record<string, unknown>>(
      system,
      user
    );
    return { value: validateCommunityVerdict(parsed), usage };
  }

  async refineVideoQuery(query: string): Promise<AIResult<string>> {
    const { system, user } = videoQueryPrompt(query);
    const { parsed, usage } = await this.json<{ query?: unknown }>(system, user);
    return { value: validateVideoQuery(parsed, query), usage };
  }

  async gradeWrittenAnswer(
    question: string,
    referenceAnswer: string,
    studentAnswer: string
  ): Promise<AIResult<WrittenGrade>> {
    const { system, user } = gradeWrittenPrompt(
      question,
      referenceAnswer,
      studentAnswer
    );
    const { parsed, usage } = await this.json<Partial<WrittenGrade>>(
      system,
      user
    );
    return { value: validateGrade(parsed), usage };
  }

  async transcribeImage(
    courseName: string,
    image: ImageInput
  ): Promise<AIResult<string>> {
    const { system, user } = transcribeImagePrompt(courseName);
    const { text, usage } = await this.generate(
      system,
      [
        {
          role: "user",
          parts: [
            { text: user },
            {
              inlineData: {
                mimeType: image.mimeType,
                data: image.data.toString("base64"),
              },
            },
          ],
        },
      ],
      false
    );
    return { value: text.trim(), usage };
  }
}
