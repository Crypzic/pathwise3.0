// Mock AI provider — deterministic, free, no API key. Lets the whole app work
// end-to-end during development. Swap to OpenAI by setting AI_PROVIDER=openai.
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

// The mock costs nothing, so it reports zero tokens. The usage row is still
// written, which keeps the metering path exercised in development.
function freeUsage(): TokenUsage {
  return { model: "mock", promptTokens: 0, completionTokens: 0 };
}

function wrap<T>(value: T): AIResult<T> {
  return { value, usage: freeUsage() };
}

// Pull candidate topic phrases out of text using simple heuristics so the
// mock still produces course-specific output instead of fixed placeholders.
function candidatePhrases(text: string): string[] {
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 3 && l.length < 80);

  // Prefer bullet/heading-ish lines; fall back to capitalized phrases.
  const headingish = lines.filter((l) =>
    /^(chapter|topic|unit|week|module|\d+[.)]|[-*•])/i.test(l)
  );
  const source = headingish.length >= 3 ? headingish : lines;

  const cleaned = source
    .map((l) =>
      l
        // Drop a leading structural label ("Chapter", "Week 3:", "1)", bullets…)
        .replace(/^(chapter|topic|unit|week|module|section|lecture)\b/i, "")
        .replace(/^[\s:.)\-*•\d]+/, "")
        // Drop a leading "objective/goal:" style lead-in.
        .replace(/^(learning objective|objective|goal)s?\s*:?\s*/i, "")
        .trim()
    )
    // Keep phrases that read like topics (a few words, not a full sentence).
    .filter((l) => l.length >= 3 && l.split(" ").length <= 7);

  return Array.from(new Set(cleaned)).slice(0, 12);
}

export class MockAIProvider implements AIProvider {
  readonly name = "mock";

  async extractTopics(
    courseName: string,
    materialText: string,
    // Mock has no document vision — accepted for interface compatibility,
    // intentionally unused.
    _documentInput?: DocumentInput
  ): Promise<AIResult<ExtractedTopic[]>> {
    const phrases = candidatePhrases(materialText);
    const base =
      phrases.length > 0
        ? phrases
        : [
            "Core Concepts",
            "Key Definitions",
            "Fundamental Principles",
            "Applications",
            "Common Pitfalls",
          ];

    // Weight by (fake) repetition: earlier + more-frequent phrases weigh more.
    // Knowledge Layer 2.0 fields are filled deterministically so the whole
    // enriched pipeline (objectives, misconceptions, prerequisites, source
    // refs) is exercisable in development.
    const topics = base.map((name, i) => {
      const occurrences =
        (materialText.match(new RegExp(escapeRegExp(name), "gi")) || []).length ||
        1;
      const weight = Math.min(1, 0.35 + occurrences * 0.12 + (base.length - i) * 0.02);
      return {
        name,
        summary: `Key ideas around "${name}" as covered in ${courseName}.`,
        weight: Number(weight.toFixed(2)),
        difficulty: Number(Math.min(1, 0.2 + i * 0.08).toFixed(2)),
        objectives: [
          `Explain ${name.toLowerCase()} in your own words`,
          `Apply ${name.toLowerCase()} to a simple example`,
        ],
        misconceptions:
          i % 2 === 0
            ? [`A common mix-up: confusing ${name.toLowerCase()} with a related idea`]
            : [],
        prerequisites: i > 0 ? [base[i - 1]] : [],
        sourceHint: `Section ${i + 1}`,
      };
    });

    return wrap(topics);
  }

  async generateQuiz(
    courseName: string,
    topics: QuizTopicInput[],
    count: number
  ): Promise<AIResult<QuizQuestion[]>> {
    const sorted = [...topics].sort((a, b) => b.weight - a.weight);
    const out: QuizQuestion[] = [];
    for (let i = 0; i < count; i++) {
      const t = sorted[i % Math.max(1, sorted.length)] ?? {
        name: "Core Concepts",
        weight: 0.5,
      };
      const correct = i % 4;
      const options = [0, 1, 2, 3].map((n) =>
        n === correct
          ? `The concept most central to ${t.name}`
          : `A plausible-but-incorrect idea about ${t.name} (${n + 1})`
      );
      out.push({
        topicName: t.name,
        question: `In ${courseName}, which of the following best describes ${t.name}?`,
        options,
        correctIndex: correct,
        explanation: `This checks understanding of ${t.name}. (Mock question — enable a real AI provider for authored questions.)`,
      });
    }
    return wrap(out);
  }

  async socraticReply(
    courseName: string,
    topicName: string | null,
    history: ChatMessage[],
    ctx?: SocraticContext
  ): Promise<AIResult<string>> {
    void courseName;
    const lastUser = [...history].reverse().find((m) => m.role === "user");
    const focus = topicName ? ` about ${topicName}` : "";
    const probe = lastUser?.content
      ? `You said: "${lastUser.content.slice(0, 80)}". `
      : "";
    // Socratic 3.0: the mock mirrors the escalation ladder deterministically
    // so the stuck-support path is testable without a real provider.
    if (ctx?.escalation === 2) {
      return wrap(
        `${probe}Let's shrink this to the very first step${focus}: what is the one term in the question you could look up or restate right now?`
      );
    }
    if (ctx?.escalation === 1) {
      return wrap(
        `${probe}Here's a more concrete nudge${focus}: focus on the part just before where you got lost. What changes at that point?`
      );
    }
    // Never a direct answer — always a guiding question.
    return wrap(
      `${probe}What do you already know${focus} that might point you toward the answer? What would happen if you tried the simplest case first?`
    );
  }

  async transcribeImage(
    courseName: string,
    image: ImageInput
  ): Promise<AIResult<string>> {
    // No vision without a real provider — produce deterministic pseudo-notes
    // so the full image path (upload -> transcribe -> screen -> topics) is
    // exercisable in development. Varies with the bytes so two different
    // images don't merge into identical topics.
    const seed = image.data.length % 5;
    const themes = [
      ["Study Notes Overview", "Definitions and Terms", "Worked Example"],
      ["Lecture Summary", "Key Formula Sheet", "Practice Checklist"],
      ["Diagram Walkthrough", "Process Steps", "Common Mistakes"],
      ["Chapter Highlights", "Important Dates", "Review Questions"],
      ["Whiteboard Snapshot", "Core Argument", "Supporting Evidence"],
    ][seed];
    const lines = themes.map(
      (t, i) =>
        `${i + 1}. ${t}\n- Main idea of ${t.toLowerCase()} for ${courseName}\n- Detail worth remembering about ${t.toLowerCase()}`
    );
    return wrap(
      `Mock transcription (${image.mimeType}, ${image.data.length} bytes)\n${lines.join("\n")}`
    );
  }

  async classifyMaterial(
    courseName: string,
    materialText: string
  ): Promise<AIResult<MaterialVerdict>> {
    void courseName;
    // Keyword screen only — enough to exercise the reject path in dev without
    // pretending to be real moderation.
    const lowered = materialText.toLowerCase();
    const banned = ["explicit sexual", "how to build a bomb", "child abuse"];
    const hit = banned.find((b) => lowered.includes(b));
    if (hit) {
      return wrap({
        verdict: "inappropriate" as const,
        reason: `Matched a blocked phrase (${hit}).`,
      });
    }
    if (materialText.trim().length < 120) {
      return wrap({
        verdict: "off_topic" as const,
        reason: "Too little readable text to be course material.",
      });
    }
    return wrap({ verdict: "clean" as const, reason: "Looks like course material." });
  }

  async evaluateCommunityPost(
    communityName: string,
    title: string,
    body: string
  ): Promise<AIResult<MaterialVerdict>> {
    void communityName;
    // Same keyword-screen spirit as classifyMaterial — enough to exercise
    // the reject path in dev without pretending to be real moderation.
    const lowered = `${title} ${body}`.toLowerCase();
    const banned = ["explicit sexual", "kill yourself", "child abuse"];
    const hit = banned.find((b) => lowered.includes(b));
    if (hit) {
      return wrap({
        verdict: "inappropriate" as const,
        reason: `Matched a blocked phrase (${hit}).`,
      });
    }
    return wrap({ verdict: "clean" as const, reason: "Looks fine for the community." });
  }

  async explainTopic(
    courseName: string,
    topicName: string,
    conceptContext: string,
    materialText: string
  ): Promise<AIResult<TopicBreakdown | null>> {
    void courseName;
    // Deterministic structure built from the concept context + material so
    // the learning surface is fully testable free.
    const phrases = candidatePhrases(materialText).slice(0, 3);
    const sections = [
      {
        heading: `What ${topicName} actually is`,
        body:
          `${topicName} is the focus of this breakdown. In plain terms, it covers the ideas your material emphasizes here. ` +
          `Key context we extracted: ${conceptContext.split("\n").slice(0, 3).join("; ")}.`,
        example: `Worked example: imagine applying ${topicName} to the simplest possible case first, then adding one complication at a time.`,
      },
      ...phrases.map((p) => ({
        heading: `How ${p} fits in`,
        body: `Your material connects ${topicName} with ${p}. Understand each on its own, then how one leads to the other.`,
      })),
    ];
    return wrap({
      overview: `${topicName}, broken down step by step from your own material — what it is, why it matters, and how its pieces fit together.`,
      sections,
      misconceptions: [
        {
          myth: `${topicName} is just memorization`,
          truth: `${topicName} is a structure of connected ideas — understand the connections and the details hold themselves.`,
        },
      ],
      summary: `${topicName}: start from the core definition, build through each section above, and test yourself with the quiz when the pieces feel connected.`,
    });
  }

  async askReply(
    courseName: string,
    topicName: string,
    history: ChatMessage[],
    grounding: string
  ): Promise<AIResult<string>> {
    void courseName;
    void grounding;
    const lastUser = [...history].reverse().find((m) => m.role === "user");
    const asked = lastUser?.content.slice(0, 80) ?? "that";
    // Explanatory surface: the mock answers directly (unlike the Socratic
    // mock) and ends with a check-in.
    return wrap(
      `Good question. About "${asked}": within ${topicName}, the direct answer is that it works exactly as the breakdown's relevant section describes — the key is the connection between the definition and the example. In short: take the core idea, apply it to the simplest case, and the behaviour you asked about follows. Does that resolve it, or should I go deeper on any part?`
    );
  }

  async generateWrittenQuestions(
    courseName: string,
    topics: QuizTopicInput[],
    count: number
  ): Promise<AIResult<WrittenQuestion[]>> {
    void courseName;
    const picked = topics.slice(0, Math.max(1, count));
    return wrap(
      Array.from({ length: count }, (_, i) => {
        const t = picked[i % picked.length];
        return {
          topicName: t.name,
          question: `In your own words, explain the core idea of ${t.name} and why it matters in this course.`,
          referenceAnswer: `${t.name} is a central concept: its core idea drives the surrounding material, and it matters because later topics build on it.`,
          explanation: `A complete answer names the core idea of ${t.name} and connects it to why the course emphasizes it.`,
        };
      })
    );
  }

  async gradeWrittenAnswer(
    question: string,
    referenceAnswer: string,
    studentAnswer: string
  ): Promise<AIResult<WrittenGrade>> {
    void question;
    // Deterministic word-overlap heuristic so the grade path is testable:
    // echoing the substance grades correct, partial overlap grades close.
    const words = (s: string) =>
      new Set(
        s
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, " ")
          .split(/\s+/)
          .filter((w) => w.length > 3)
      );
    const ref = words(referenceAnswer);
    const student = words(studentAnswer);
    let hits = 0;
    for (const w of ref) if (student.has(w)) hits += 1;
    const ratio = ref.size === 0 ? 0 : hits / ref.size;
    const verdict = ratio >= 0.5 ? "correct" : ratio >= 0.2 ? "close" : "incorrect";
    const explanation =
      verdict === "correct"
        ? `Yes — you captured the substance. Model answer for comparison: ${referenceAnswer}`
        : verdict === "close"
          ? `You're partway there — part of the idea is present, but something important is missing. The complete answer: ${referenceAnswer}`
          : `Not this time — the core idea isn't there yet. Here's the answer to learn from: ${referenceAnswer}`;
    return wrap({ verdict, explanation });
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
