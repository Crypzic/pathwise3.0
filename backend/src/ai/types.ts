// The AI provider interface. Every feature that needs AI goes through this,
// so we can swap "mock" <-> "openai" (or add Claude later) in one place.
//
// Every method returns its token usage alongside the result. Cost metering
// (lib/aiMeter.ts) depends on that being reported per call, not tracked in a
// module-level global — concurrent requests would corrupt a shared counter.

export interface TokenUsage {
  model: string;
  promptTokens: number;
  completionTokens: number;
}

export interface AIResult<T> {
  value: T;
  usage: TokenUsage;
}

export interface ExtractedTopic {
  name: string;
  summary: string;
  weight: number; // 0..1 emphasis
  // --- Knowledge Layer 2.0 (Phase 6) — optional, all grounded in material.
  difficulty?: number; // 0 (intro) .. 1 (advanced)
  objectives?: string[]; // what the student should be able to DO
  misconceptions?: string[]; // wrong ideas worth probing/distracting with
  prerequisites?: string[]; // NAMES of other topics to learn first
  sourceHint?: string; // where in the material, e.g. "Week 3"
}

export interface QuizQuestion {
  topicName: string;
  question: string;
  options: string[]; // multiple choice
  correctIndex: number;
  explanation: string;
}

/** What quiz generation knows about each topic (Knowledge Layer 2.0 enriched). */
export interface QuizTopicInput {
  name: string;
  weight: number;
  difficulty?: number;
  misconceptions?: string[];
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Socratic 3.0 (Phase 7): what the tutor knows beyond the transcript. */
export interface SocraticContext {
  /** Knowledge Layer grounding block (concept + mastery), or null. */
  grounding?: string | null;
  /** 0 = normal, 1 = concrete hint, 2 = decompose to the first step. */
  escalation?: 0 | 1 | 2;
}

/** An uploaded image handed to a vision-capable provider (2.0 Phase 5). */
export interface ImageInput {
  data: Buffer;
  // "image/png" | "image/jpeg" | "image/webp"
  mimeType: string;
}

/**
 * The original PDF bytes, handed to a provider alongside the locally
 * extracted text so a multimodal-document-capable provider (Gemini) can
 * read diagrams/tables/charts natively instead of relying on text alone.
 * Optional — providers without document vision just ignore it.
 */
export interface DocumentInput {
  data: Buffer;
  mimeType: string; // "application/pdf"
}

/**
 * Learning layer: the lecturer-style breakdown of one topic, generated from
 * the course's own material and cached on the Topic row.
 */
export interface BreakdownSection {
  heading: string;
  body: string;
  example?: string;
}

export interface TopicBreakdown {
  overview: string;
  sections: BreakdownSection[];
  misconceptions: { myth: string; truth: string }[];
  summary: string;
}

/** Two-phase quizzes: a written-answer question with its model answer. */
export interface WrittenQuestion {
  topicName: string;
  question: string;
  referenceAnswer: string;
  explanation: string;
}

/** Grading a student's written answer. */
export interface WrittenGrade {
  verdict: "correct" | "close" | "incorrect";
  explanation: string;
}

/** Step 15: verdict on whether uploaded material belongs in a study app. */
export interface MaterialVerdict {
  // "clean" — course material. "off_topic" — not study material at all.
  // "inappropriate" — content we won't process.
  verdict: "clean" | "off_topic" | "inappropriate";
  reason: string;
}

export interface AIProvider {
  readonly name: string;

  /**
   * Step 2: pull weighted topics out of raw course material text.
   * `documentInput`, when given, is the original PDF bytes — a
   * document-vision-capable provider (Gemini) can use it to read
   * diagrams/tables/charts the text extraction alone would miss.
   */
  extractTopics(
    courseName: string,
    materialText: string,
    documentInput?: DocumentInput
  ): Promise<AIResult<ExtractedTopic[]>>;

  /** Step 5: generate practice questions weighted toward emphasized topics. */
  generateQuiz(
    courseName: string,
    topics: QuizTopicInput[],
    count: number
  ): Promise<AIResult<QuizQuestion[]>>;

  /**
   * Step 7: Socratic tutor turn. MUST return a guiding question, never a
   * direct answer. The system prompt enforces this; providers must honor it,
   * and lib/socraticGuard.ts checks the output regardless. Socratic 3.0
   * passes grounding + escalation via `ctx` (optional for compatibility).
   */
  socraticReply(
    courseName: string,
    topicName: string | null,
    history: ChatMessage[],
    ctx?: SocraticContext
  ): Promise<AIResult<string>>;

  /** Step 15: screen uploaded material before it becomes a knowledge map. */
  classifyMaterial(
    courseName: string,
    materialText: string
  ): Promise<AIResult<MaterialVerdict>>;

  /**
   * Screen a community post before it goes live — runs after the local
   * regex spam screen, catches what regex can't (harassment, subtly
   * off-topic/inappropriate content). Reuses the MaterialVerdict shape:
   * "clean" | "off_topic" | "inappropriate".
   */
  evaluateCommunityPost(
    communityName: string,
    title: string,
    body: string
  ): Promise<AIResult<MaterialVerdict>>;

  /**
   * Learning layer: an extensive, lecturer-grade breakdown of ONE topic,
   * grounded in the course's own material. Explanations are allowed here —
   * this is the teaching surface; the no-answers contract belongs to the
   * Socratic tutor alone.
   */
  explainTopic(
    courseName: string,
    topicName: string,
    conceptContext: string,
    materialText: string
  ): Promise<AIResult<TopicBreakdown | null>>;

  /**
   * Learning layer: a helpful expert reply on a topic page. May explain
   * directly (the roadmap's "explanatory response based on intent"), stays
   * grounded in the topic, and checks understanding as it goes.
   */
  askReply(
    courseName: string,
    topicName: string,
    history: ChatMessage[],
    grounding: string
  ): Promise<AIResult<string>>;

  /** Two-phase quizzes: written-answer questions for the given topics. */
  generateWrittenQuestions(
    courseName: string,
    topics: QuizTopicInput[],
    count: number
  ): Promise<AIResult<WrittenQuestion[]>>;

  /** Grade a student's written answer against the reference. */
  gradeWrittenAnswer(
    question: string,
    referenceAnswer: string,
    studentAnswer: string
  ): Promise<AIResult<WrittenGrade>>;

  /**
   * PATHWISE 2.0 Phase 5: turn a photo/screenshot of study material (notes,
   * whiteboard, textbook page, slide, diagram) into clean structured text.
   * The result feeds the SAME text pipeline as documents — screening, topic
   * extraction, the knowledge map — so downstream code never knows the
   * material arrived as pixels. Returns "" when nothing educational is
   * legible in the image.
   */
  transcribeImage(
    courseName: string,
    image: ImageInput
  ): Promise<AIResult<string>>;
}
