// Knowledge Layer 2.0 — pure shaping/formatting (PATHWISE 2.0 Phase 6).
// No database or config imports; unit-tested directly. The fetch wrappers
// live in knowledgeLayer.ts, same split as mastery/masteryModel.
import { parseStoredList } from "./onboardingModel.js";

export interface ConceptView {
  id: string;
  name: string;
  summary: string | null;
  weight: number;
  difficulty: number | null;
  objectives: string[];
  misconceptions: string[];
  prerequisites: string[];
  sourceRef: string | null;
}

/** Shape a Topic row (with its JSON columns) into a typed concept. */
export function toConceptView(topic: {
  id: string;
  name: string;
  summary: string | null;
  weight: number;
  difficulty: number | null;
  objectivesJson: string;
  misconceptionsJson: string;
  prerequisitesJson: string;
  sourceRef: string | null;
}): ConceptView {
  return {
    id: topic.id,
    name: topic.name,
    summary: topic.summary,
    weight: topic.weight,
    difficulty: topic.difficulty,
    objectives: parseStoredList(topic.objectivesJson),
    misconceptions: parseStoredList(topic.misconceptionsJson),
    prerequisites: parseStoredList(topic.prerequisitesJson),
    sourceRef: topic.sourceRef,
  };
}

export function difficultyLabel(d: number): string {
  if (d < 0.34) return "introductory";
  if (d < 0.67) return "intermediate";
  return "advanced";
}

/**
 * A compact text block a tutor prompt can be grounded in. Pure — feed it any
 * concept. Mastery (0..1) is optional and rendered as a percentage the tutor
 * can pitch against.
 */
export function formatConceptContext(
  concept: ConceptView,
  mastery?: number
): string {
  const lines: string[] = [`Topic: ${concept.name}`];
  if (concept.summary) lines.push(`Summary: ${concept.summary}`);
  if (concept.difficulty !== null) {
    lines.push(`Level in this course: ${difficultyLabel(concept.difficulty)}`);
  }
  if (concept.objectives.length > 0) {
    lines.push(`Learning objectives: ${concept.objectives.join("; ")}`);
  }
  if (concept.misconceptions.length > 0) {
    lines.push(
      `Common misconceptions to probe for: ${concept.misconceptions.join("; ")}`
    );
  }
  if (concept.prerequisites.length > 0) {
    lines.push(`Builds on: ${concept.prerequisites.join(", ")}`);
  }
  if (mastery !== undefined) {
    lines.push(`Student's current mastery: ${Math.round(mastery * 100)}%`);
  }
  if (concept.sourceRef) lines.push(`Source: ${concept.sourceRef}`);
  return lines.join("\n");
}
