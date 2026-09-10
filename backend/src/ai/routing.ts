// Per-task AI routing — pure mapping, unit-tested.
//
// Every metered operation belongs to exactly one route group; env can point
// each group at a different provider (the right model for each job) while
// AI_PROVIDER stays the global default. Adding an operation without adding
// it here is a compile error — the Record below is exhaustive.

export type AIOperationName =
  | "extract_topics"
  | "generate_quiz"
  | "socratic_reply"
  | "moderate"
  | "transcribe_image"
  | "explain_topic"
  | "ask_reply"
  | "written_questions"
  | "grade_written"
  | "community_check"
  | "video_query";

export type RouteGroup = "tutor" | "quiz" | "moderation" | "extract";

const GROUPS: Record<AIOperationName, RouteGroup> = {
  // Learning quality — where a stronger model earns its price.
  socratic_reply: "tutor",
  ask_reply: "tutor",
  explain_topic: "tutor",
  // Question generation + grading.
  generate_quiz: "quiz",
  written_questions: "quiz",
  grade_written: "quiz",
  // High-volume, simple judgments — cheap and fast wins.
  moderate: "moderation",
  community_check: "moderation",
  // Turning material into structure (vision-capable provider needed for
  // transcribe_image — gemini, openai, or claude).
  extract_topics: "extract",
  transcribe_image: "extract",
  video_query: "extract",
};

export function routeGroupFor(operation: AIOperationName): RouteGroup {
  return GROUPS[operation];
}
