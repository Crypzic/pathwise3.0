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
  DocumentInput,
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
  evaluateCommunityPostPrompt,
  explainTopicPrompt,
  extractTopicsPrompt,
  generateQuizPrompt,
  gradeWrittenPrompt,
  SOCRATIC_FALLBACK,
  socraticSystemPrompt,
  transcribeImagePrompt,
  validateBreakdown,
  validateGrade,
  validateQuestions,
  validateTopics,
  validateVerdict,
  validateWrittenQuestions,
  writtenQuestionsPrompt,
} from "./prompts.js";
import { env } from "../lib/env.js";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const REQUEST_TIMEOUT_MS = 60_000;

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

  private async callModel(
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
      // Meterable failure — aiMeter records the message on the AIUsage row.
      throw new Error(
        `Gemini ${res.status}: ${data.error?.message ?? res.statusText}`
      );
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
   * Same call as callModel, but retries once against GEMINI_FALLBACK_MODEL
   * if the primary model call fails (timeout, 5xx, or any thrown error) —
   * so one bad model rollout or transient outage degrades to a second
   * model instead of surfacing a 500 to the student. Callers further up
   * (aiMeter -> features) still see a plain failure if BOTH calls fail,
   * which is what lets the mock-provider fallback and "failed" upload
   * status kick in exactly as before.
   */
  private async generate(
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
    try {
      return await this.callModel(this.model, system, contents, jsonMode);
    } catch (err) {
      const fallback = env.GEMINI_FALLBACK_MODEL;
      if (!fallback || fallback === this.model) throw err;
      try {
        return await this.callModel(fallback, system, contents, jsonMode);
      } catch {
        // Surface the ORIGINAL error — it's the more useful one to log/meter.
        throw err;
      }
    }
  }

  private async json<T>(
    system: string,
    user: string,
    extraParts: { inlineData: { mimeType: string; data: string } }[] = []
  ): Promise<{ parsed: T; usage: TokenUsage }> {
    const { text, usage } = await this.generate(
      system,
      [{ role: "user", parts: [{ text: user }, ...extraParts] }],
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
    materialText: string,
    documentInput?: DocumentInput
  ): Promise<AIResult<ExtractedTopic[]>> {
    const { system, user } = extractTopicsPrompt(courseName, materialText);
    // documentInput carries the original PDF bytes — Gemini reads it with
    // native document vision (diagrams, tables, charts) alongside the
    // already-extracted text, rather than relying on text alone.
    const extraParts = documentInput
      ? [
          {
            inlineData: {
              mimeType: documentInput.mimeType,
              data: documentInput.data.toString("base64"),
            },
          },
        ]
      : [];
    const { parsed, usage } = await this.json<{ topics: ExtractedTopic[] }>(
      system,
      user,
      extraParts
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

  async evaluateCommunityPost(
    communityName: string,
    title: string,
    body: string
  ): Promise<AIResult<MaterialVerdict>> {
    const { system, user } = evaluateCommunityPostPrompt(
      communityName,
      title,
      body
    );
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
