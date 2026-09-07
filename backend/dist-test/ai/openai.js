// OpenAI provider. Only used when AI_PROVIDER=openai and OPENAI_API_KEY is set.
//
// Prompts and response validation live in ./prompts.ts, shared with every
// real provider — this file is transport only (PATHWISE 2.0 Phase 3).
import OpenAI from "openai";
import { askSystemPrompt, classifyMaterialPrompt, evaluateCommunityPostPrompt, explainTopicPrompt, extractTopicsPrompt, generateQuizPrompt, gradeWrittenPrompt, SOCRATIC_FALLBACK, socraticSystemPrompt, transcribeImagePrompt, validateBreakdown, validateGrade, validateQuestions, validateTopics, validateVerdict, validateWrittenQuestions, writtenQuestionsPrompt, } from "./prompts.js";
import { env } from "../lib/env.js";
export class OpenAIProvider {
    name = "openai";
    client;
    model;
    constructor() {
        this.client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
        this.model = env.OPENAI_MODEL;
    }
    usageOf(res) {
        return {
            model: this.model,
            promptTokens: res.usage?.prompt_tokens ?? 0,
            completionTokens: res.usage?.completion_tokens ?? 0,
        };
    }
    async json(system, user) {
        const res = await this.client.chat.completions.create({
            model: this.model,
            response_format: { type: "json_object" },
            messages: [
                { role: "system", content: system },
                { role: "user", content: user },
            ],
        });
        const text = res.choices[0]?.message?.content ?? "{}";
        let parsed;
        try {
            parsed = JSON.parse(text);
        }
        catch {
            // A malformed response shouldn't 500 the request — callers handle empty.
            parsed = {};
        }
        return { parsed, usage: this.usageOf(res) };
    }
    async extractTopics(courseName, materialText, 
    // OpenAI path here has no document-vision wiring yet — accepted for
    // interface compatibility, intentionally unused.
    _documentInput) {
        const { system, user } = extractTopicsPrompt(courseName, materialText);
        const { parsed, usage } = await this.json(system, user);
        return { value: validateTopics(parsed), usage };
    }
    async generateQuiz(courseName, topics, count) {
        const { system, user } = generateQuizPrompt(courseName, topics, count);
        const { parsed, usage } = await this.json(system, user);
        return { value: validateQuestions(parsed), usage };
    }
    async socraticReply(courseName, topicName, history, ctx) {
        const res = await this.client.chat.completions.create({
            model: this.model,
            messages: [
                {
                    role: "system",
                    content: socraticSystemPrompt(courseName, topicName, ctx),
                },
                ...history.map((m) => ({ role: m.role, content: m.content })),
            ],
        });
        const value = res.choices[0]?.message?.content ?? SOCRATIC_FALLBACK;
        return { value, usage: this.usageOf(res) };
    }
    async classifyMaterial(courseName, materialText) {
        const { system, user } = classifyMaterialPrompt(courseName, materialText);
        const { parsed, usage } = await this.json(system, user);
        return { value: validateVerdict(parsed), usage };
    }
    async evaluateCommunityPost(communityName, title, body) {
        const { system, user } = evaluateCommunityPostPrompt(communityName, title, body);
        const { parsed, usage } = await this.json(system, user);
        return { value: validateVerdict(parsed), usage };
    }
    async explainTopic(courseName, topicName, conceptContext, materialText) {
        const { system, user } = explainTopicPrompt(courseName, topicName, conceptContext, materialText);
        const { parsed, usage } = await this.json(system, user);
        return { value: validateBreakdown(parsed), usage };
    }
    async askReply(courseName, topicName, history, grounding) {
        const res = await this.client.chat.completions.create({
            model: this.model,
            messages: [
                {
                    role: "system",
                    content: askSystemPrompt(courseName, topicName, grounding),
                },
                ...history.map((m) => ({ role: m.role, content: m.content })),
            ],
        });
        const value = res.choices[0]?.message?.content ??
            "Could you ask that again in different words?";
        return { value, usage: this.usageOf(res) };
    }
    async generateWrittenQuestions(courseName, topics, count) {
        const { system, user } = writtenQuestionsPrompt(courseName, topics, count);
        const { parsed, usage } = await this.json(system, user);
        return { value: validateWrittenQuestions(parsed), usage };
    }
    async gradeWrittenAnswer(question, referenceAnswer, studentAnswer) {
        const { system, user } = gradeWrittenPrompt(question, referenceAnswer, studentAnswer);
        const { parsed, usage } = await this.json(system, user);
        return { value: validateGrade(parsed), usage };
    }
    async transcribeImage(courseName, image) {
        const { system, user } = transcribeImagePrompt(courseName);
        const res = await this.client.chat.completions.create({
            model: this.model,
            messages: [
                { role: "system", content: system },
                {
                    role: "user",
                    content: [
                        { type: "text", text: user },
                        {
                            type: "image_url",
                            image_url: {
                                url: `data:${image.mimeType};base64,${image.data.toString("base64")}`,
                            },
                        },
                    ],
                },
            ],
        });
        const value = (res.choices[0]?.message?.content ?? "").trim();
        return { value, usage: this.usageOf(res) };
    }
}
