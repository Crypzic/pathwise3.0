// Claude (Anthropic) provider. Only used when a route or AI_PROVIDER
// selects "claude" and ANTHROPIC_API_KEY is set.
//
// Prompts and response validation live in ./prompts.ts, shared with every
// real provider — this file is transport only. Uses the official
// @anthropic-ai/sdk Messages API; JSON operations instruct the model to
// answer with a single JSON object and parse the text reply (fences
// stripped defensively), matching the contract the shared validators expect.
import Anthropic from "@anthropic-ai/sdk";
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

const JSON_INSTRUCTION =
  "\nRespond with ONLY the JSON object — no prose, no markdown fences.";

export class ClaudeProvider implements AIProvider {
  readonly name = "claude";
  private client: Anthropic;
  private model: string;

  constructor() {
    this.client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    this.model = env.CLAUDE_MODEL;
  }

  private usageOf(res: {
    usage: { input_tokens: number; output_tokens: number };
  }): TokenUsage {
    return {
      model: this.model,
      promptTokens: res.usage.input_tokens,
      completionTokens: res.usage.output_tokens,
    };
  }

  private textOf(res: Anthropic.Message): string {
    return res.content
      .filter(
        (block): block is Anthropic.TextBlock => block.type === "text"
      )
      .map((block) => block.text)
      .join("");
  }

  private async json<T>(
    system: string,
    user: string,
    maxTokens = 4096
  ): Promise<{ parsed: T; usage: TokenUsage }> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: maxTokens,
      system: system + JSON_INSTRUCTION,
      messages: [{ role: "user", content: user }],
    });
    let text = this.textOf(res).trim();
    // Defensive: strip markdown fences if the model wrapped the JSON anyway.
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    let parsed: T;
    try {
      parsed = JSON.parse(text) as T;
    } catch {
      // A malformed response shouldn't 500 the request — callers handle empty.
      parsed = {} as T;
    }
    return { parsed, usage: this.usageOf(res) };
  }

  async extractTopics(
    courseName: string,
    materialText: string
  ): Promise<AIResult<ExtractedTopic[]>> {
    const { system, user } = extractTopicsPrompt(courseName, materialText);
    const { parsed, usage } = await this.json<{ topics: unknown }>(
      system,
      user
    );
    return { value: validateTopics(parsed as { topics?: never }), usage };
  }

  async generateQuiz(
    courseName: string,
    topics: QuizTopicInput[],
    count: number
  ): Promise<AIResult<QuizQuestion[]>> {
    const { system, user } = generateQuizPrompt(courseName, topics, count);
    const { parsed, usage } = await this.json<{ questions: unknown }>(
      system,
      user,
      8192
    );
    return {
      value: validateQuestions(parsed as { questions?: never }),
      usage,
    };
  }

  async socraticReply(
    courseName: string,
    topicName: string | null,
    history: ChatMessage[],
    ctx?: SocraticContext
  ): Promise<AIResult<string>> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: socraticSystemPrompt(courseName, topicName, ctx),
      messages: history.map((m) => ({ role: m.role, content: m.content })),
    });
    const value = this.textOf(res).trim() || SOCRATIC_FALLBACK;
    return { value, usage: this.usageOf(res) };
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

  async transcribeImage(
    courseName: string,
    image: ImageInput
  ): Promise<AIResult<string>> {
    const { system, user } = transcribeImagePrompt(courseName);
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 8192,
      system,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: image.mimeType as
                  | "image/png"
                  | "image/jpeg"
                  | "image/webp",
                data: image.data.toString("base64"),
              },
            },
            { type: "text", text: user },
          ],
        },
      ],
    });
    return { value: this.textOf(res).trim(), usage: this.usageOf(res) };
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
      user,
      16000
    );
    return { value: validateBreakdown(parsed), usage };
  }

  async askReply(
    courseName: string,
    topicName: string,
    history: ChatMessage[],
    grounding: string
  ): Promise<AIResult<string>> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 2048,
      system: askSystemPrompt(courseName, topicName, grounding),
      messages: history.map((m) => ({ role: m.role, content: m.content })),
    });
    const value =
      this.textOf(res).trim() ||
      "Could you ask that again in different words?";
    return { value, usage: this.usageOf(res) };
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
    const { parsed, usage } = await this.json<{ query?: unknown }>(
      system,
      user
    );
    return { value: validateVideoQuery(parsed, query), usage };
  }
}
