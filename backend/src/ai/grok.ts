// Grok (xAI) provider. Only used when a route or AI_PROVIDER selects
// "grok" and XAI_API_KEY is set.
//
// xAI's API is OpenAI-compatible, so this is the OpenAI SDK pointed at
// https://api.x.ai/v1 — prompts and validation stay in ./prompts.ts like
// every other provider; this file is transport only. transcribeImage sends
// OpenAI-style image_url content; point AI_PROVIDER_EXTRACT at a
// vision-capable Grok model (or another provider) before relying on it.
import OpenAI from "openai";
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

export class GrokProvider implements AIProvider {
  readonly name = "grok";
  private client: OpenAI;
  private model: string;

  constructor() {
    this.client = new OpenAI({
      apiKey: env.XAI_API_KEY,
      baseURL: "https://api.x.ai/v1",
    });
    this.model = env.GROK_MODEL;
  }

  private usageOf(res: {
    usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  }): TokenUsage {
    return {
      model: this.model,
      promptTokens: res.usage?.prompt_tokens ?? 0,
      completionTokens: res.usage?.completion_tokens ?? 0,
    };
  }

  private async json<T>(
    system: string,
    user: string
  ): Promise<{ parsed: T; usage: TokenUsage }> {
    const res = await this.client.chat.completions.create({
      model: this.model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    let text = res.choices[0]?.message?.content ?? "{}";
    text = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    let parsed: T;
    try {
      parsed = JSON.parse(text) as T;
    } catch {
      parsed = {} as T;
    }
    return { parsed, usage: this.usageOf(res) };
  }

  async extractTopics(
    courseName: string,
    materialText: string
  ): Promise<AIResult<ExtractedTopic[]>> {
    const { system, user } = extractTopicsPrompt(courseName, materialText);
    const { parsed, usage } = await this.json<{ topics?: never }>(system, user);
    return { value: validateTopics(parsed), usage };
  }

  async generateQuiz(
    courseName: string,
    topics: QuizTopicInput[],
    count: number
  ): Promise<AIResult<QuizQuestion[]>> {
    const { system, user } = generateQuizPrompt(courseName, topics, count);
    const { parsed, usage } = await this.json<{ questions?: never }>(
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
    const res = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: "system",
          content: socraticSystemPrompt(courseName, topicName, ctx),
        },
        ...history.map((m) => ({ role: m.role, content: m.content }) as const),
      ],
    });
    const value = res.choices[0]?.message?.content?.trim() || SOCRATIC_FALLBACK;
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
    const res = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:${image.mimeType};base64,${image.data.toString("base64")}`,
              },
            },
            { type: "text", text: user },
          ],
        },
      ],
    });
    return {
      value: res.choices[0]?.message?.content?.trim() ?? "",
      usage: this.usageOf(res),
    };
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
    const res = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: "system",
          content: askSystemPrompt(courseName, topicName, grounding),
        },
        ...history.map((m) => ({ role: m.role, content: m.content }) as const),
      ],
    });
    const value =
      res.choices[0]?.message?.content?.trim() ||
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
