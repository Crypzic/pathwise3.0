// Personalized onboarding (PATHWISE 2.0 Phase 2).
//
// GET returns the saved profile plus the option catalogs (one source of truth
// for keys/labels); PUT saves it. The same endpoints back the first-run wizard
// and later edits from the Profile screen — the signals must stay editable.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { track } from "../lib/analytics.js";
import {
  ACADEMIC_LEVELS,
  AVAILABILITY,
  CONTENT_PREFS,
  STUDY_STYLES,
  isAcademicLevel,
  isStudyStyle,
  normalizeBuddyPrefs,
  normalizeContentPrefs,
  normalizeFreeList,
  parseStoredList,
} from "../lib/onboardingModel.js";
import type { LearnerProfile } from "@prisma/client";

const saveSchema = z.object({
  field: z.string().max(80).optional(),
  academicLevel: z.string().max(40).optional(),
  subjects: z.array(z.string().max(200)).max(50).optional(),
  topics: z.array(z.string().max(200)).max(50).optional(),
  contentPrefs: z.array(z.string().max(40)).max(20).optional(),
  communityInterests: z.array(z.string().max(200)).max(50).optional(),
  studyStyle: z.string().max(40).optional(),
  buddyPrefs: z
    .object({
      similarLevel: z.boolean().optional(),
      sameSubjects: z.boolean().optional(),
      availability: z.string().max(40).nullable().optional(),
    })
    .optional(),
  // True when the wizard finishes (or is skipped) — stops re-prompting.
  complete: z.boolean().optional(),
});

function parseStoredObject(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

function shaped(profile: LearnerProfile | null) {
  return {
    field: profile?.field ?? null,
    academicLevel: profile?.academicLevel ?? null,
    subjects: profile ? parseStoredList(profile.subjectsJson) : [],
    topics: profile ? parseStoredList(profile.topicsJson) : [],
    contentPrefs: profile ? parseStoredList(profile.contentPrefsJson) : [],
    communityInterests: profile
      ? parseStoredList(profile.communityInterestsJson)
      : [],
    studyStyle: profile?.studyStyle ?? null,
    buddyPrefs: normalizeBuddyPrefs(
      profile ? parseStoredObject(profile.buddyPrefsJson || "{}") : {}
    ),
    onboarded: profile?.onboardedAt != null,
  };
}

export default async function onboardingRoutes(app: FastifyInstance) {
  app.get(
    "/api/onboarding",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const profile = await prisma.learnerProfile.findUnique({
        where: { userId: req.user.sub },
      });
      return reply.send({
        profile: shaped(profile),
        catalog: {
          academicLevels: ACADEMIC_LEVELS,
          contentPrefs: CONTENT_PREFS,
          studyStyles: STUDY_STYLES,
          availability: AVAILABILITY,
        },
      });
    }
  );

  app.put(
    "/api/onboarding",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const parsed = saveSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "Invalid input", details: parsed.error.flatten() });
      }
      const d = parsed.data;

      if (d.academicLevel !== undefined && d.academicLevel !== "" && !isAcademicLevel(d.academicLevel)) {
        return reply.code(400).send({ error: "Unknown academic level." });
      }
      if (d.studyStyle !== undefined && d.studyStyle !== "" && !isStudyStyle(d.studyStyle)) {
        return reply.code(400).send({ error: "Unknown study style." });
      }

      // Only touch what was sent — the wizard saves per-step, the Profile
      // editor saves everything.
      const data: Record<string, unknown> = {};
      if (d.field !== undefined) data.field = d.field.trim() || null;
      if (d.academicLevel !== undefined)
        data.academicLevel = d.academicLevel || null;
      if (d.subjects !== undefined)
        data.subjectsJson = JSON.stringify(normalizeFreeList(d.subjects));
      if (d.topics !== undefined)
        data.topicsJson = JSON.stringify(normalizeFreeList(d.topics));
      if (d.contentPrefs !== undefined)
        data.contentPrefsJson = JSON.stringify(
          normalizeContentPrefs(d.contentPrefs)
        );
      if (d.communityInterests !== undefined)
        data.communityInterestsJson = JSON.stringify(
          normalizeFreeList(d.communityInterests)
        );
      if (d.studyStyle !== undefined) data.studyStyle = d.studyStyle || null;
      if (d.buddyPrefs !== undefined) {
        // The wizard never sends `discoverable` (that's the /api/buddies
        // privacy switch), so preserve the stored value — an onboarding
        // save must not silently hide someone who opted in.
        const existing = await prisma.learnerProfile.findUnique({
          where: { userId: req.user.sub },
          select: { buddyPrefsJson: true },
        });
        const stored = normalizeBuddyPrefs(
          existing ? parseStoredObject(existing.buddyPrefsJson || "{}") : {}
        );
        data.buddyPrefsJson = JSON.stringify(
          normalizeBuddyPrefs({
            discoverable: stored.discoverable,
            ...d.buddyPrefs,
          })
        );
      }
      if (d.complete) data.onboardedAt = new Date();

      const profile = await prisma.learnerProfile.upsert({
        where: { userId: req.user.sub },
        create: { userId: req.user.sub, ...data },
        update: data,
      });

      if (d.complete) {
        await track(req.user.sub, "onboarding_completed", {
          hasField: Boolean(profile.field),
          subjects: parseStoredList(profile.subjectsJson).length,
          topics: parseStoredList(profile.topicsJson).length,
        });
      }

      return reply.send({ profile: shaped(profile) });
    }
  );
}
