import { askSystemPrompt, classifyMaterialPrompt, evaluateCommunityPostPrompt, explainTopicPrompt, extractTopicsPrompt, generateQuizPrompt, gradeWrittenPrompt, SOCRATIC_FALLBACK, socraticSystemPrompt, transcribeImagePrompt, validateBreakdown, validateGrade, validateQuestions, validateTopics, validateVerdict, validateWrittenQuestions, writtenQuestionsPrompt, } from "./prompts.js";
import { env } from "../lib/env.js";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const REQUEST_TIMEOUT_MS = 60_000;
export class GeminiProvider {
    name = "gemini";
    model;
    constructor() {
        this.model = env.GEMINI_MODEL;
    }
    async callModel(model, system, contents, jsonMode) {
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
        const data = (await res.json().catch(() => ({})));
        if (!res.ok) {
            // Meterable failure — aiMeter records the message on the AIUsage row.
            throw new Error(`Gemini ${res.status}: ${data.error?.message ?? res.statusText}`);
        }
        const text = data.candidates?.[0]?.content?.parts
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
    async generate(system, contents, jsonMode) {
        try {
            return await this.callModel(this.model, system, contents, jsonMode);
        }
        catch (err) {
            const fallback = env.GEMINI_FALLBACK_MODEL;
            if (!fallback || fallback === this.model)
                throw err;
            try {
                return await this.callModel(fallback, system, contents, jsonMode);
            }
            catch {
                // Surface the ORIGINAL error — it's the more useful one to log/meter.
                throw err;
            }
        }
    }
    async json(system, user, extraParts = []) {
        const { text, usage } = await this.generate(system, [{ role: "user", parts: [{ text: user }, ...extraParts] }], true);
        let parsed;
        try {
            parsed = JSON.parse(text);
        }
        catch {
            // A malformed response shouldn't 500 the request — callers handle empty.
            parsed = {};
        }
        return { parsed, usage };
    }
    async extractTopics(courseName, materialText, documentInput) {
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
        const { parsed, usage } = await this.json(system, user, extraParts);
        return { value: validateTopics(parsed), usage };
    }
    async generateQuiz(courseName, topics, count) {
        const { system, user } = generateQuizPrompt(courseName, topics, count);
        const { parsed, usage } = await this.json(system, user);
        return { value: validateQuestions(parsed), usage };
    }
    async socraticReply(courseName, topicName, history, ctx) {
        // Gemini's chat roles are "user" | "model"; ours are "user" | "assistant".
        const contents = history.map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }],
        }));
        const { text, usage } = await this.generate(socraticSystemPrompt(courseName, topicName, ctx), contents, false);
        return { value: text.trim() || SOCRATIC_FALLBACK, usage };
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
        const contents = history.map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }],
        }));
        const { text, usage } = await this.generate(askSystemPrompt(courseName, topicName, grounding), contents, false);
        return {
            value: text.trim() || "Could you ask that again in different words?",
            usage,
        };
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
        const { text, usage } = await this.generate(system, [
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
        ], false);
        return { value: text.trim(), usage };
    }
}
