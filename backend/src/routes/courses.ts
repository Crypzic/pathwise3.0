import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { storage } from "../lib/storage.js";
import { imageKindFor, kindFor } from "../lib/parse.js";
import {
  matchesImageSignature,
  matchesSignature,
} from "../lib/fileSignature.js";
import { processUpload } from "../lib/knowledge.js";
import { entitlementsFor } from "../lib/billing.js";
import {
  topicsWithMastery,
  courseMasteryPct,
  isDue,
} from "../lib/mastery.js";
import { track } from "../lib/analytics.js";
import { AIBudgetExceededError } from "../lib/aiMeter.js";
import { isGuestUser } from "../lib/guests.js";
import { guestFileTooLarge, guestMayUpload } from "../lib/guestPolicy.js";
import { env } from "../lib/env.js";
import type { Upload } from "@prisma/client";

const createSchema = z.object({
  name: z.string().min(1).max(120),
  icon: z.string().max(40).optional(),
});

const renameSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  icon: z.string().max(40).optional(),
});

export default async function courseRoutes(app: FastifyInstance) {
  // List the signed-in user's courses (for the Courses home grid).
  app.get("/api/courses", { preHandler: [app.authenticate] }, async (req, reply) => {
    const courses = await prisma.course.findMany({
      where: { userId: req.user.sub },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, icon: true, createdAt: true },
    });

    const user = await prisma.user.findUnique({
      where: { id: req.user.sub },
      select: { streakCount: true },
    });
    const entitlements = await entitlementsFor(req.user.sub);

    // Mastery is weighted by topic emphasis, so the card number matches what
    // the study plan and dashboard show for the same course.
    const shaped = await Promise.all(
      courses.map(async (c) => {
        const topics = await topicsWithMastery(req.user.sub, c.id);
        return {
          id: c.id,
          name: c.name,
          icon: c.icon,
          mastery: courseMasteryPct(topics),
          topicCount: topics.length,
          dueCount: topics.filter((t) => t.attemptCount > 0 && isDue(t.dueAt)).length,
          // The streak is per-user, not per-course, but the mockup shows the
          // flame on each card.
          streak: user?.streakCount ?? 0,
          createdAt: c.createdAt,
        };
      })
    );

    const cap = entitlements.courseCap;
    return reply.send({
      courses: shaped,
      meta: {
        count: shaped.length,
        cap,
        isPremium: entitlements.isPremium,
        atCap: cap !== null && shaped.length >= cap,
      },
    });
  });

  // Create a course. Enforces the free-tier course cap (Step 3).
  app.post("/api/courses", { preHandler: [app.authenticate] }, async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input" });
    }

    const entitlements = await entitlementsFor(req.user.sub);
    if (entitlements.courseCap !== null) {
      const count = await prisma.course.count({ where: { userId: req.user.sub } });
      if (count >= entitlements.courseCap) {
        return reply.code(402).send({
          error: "course_cap_reached",
          message: `Free plan is limited to ${entitlements.courseCap} courses.`,
          cap: entitlements.courseCap,
        });
      }
    }

    const course = await prisma.course.create({
      data: {
        userId: req.user.sub,
        name: parsed.data.name,
        icon: parsed.data.icon ?? "book",
        knowledgeMap: { create: {} },
      },
    });

    await track(req.user.sub, "course_created", { courseId: course.id });

    return reply.code(201).send({
      course: { id: course.id, name: course.name, icon: course.icon, mastery: 0, topicCount: 0 },
    });
  });

  // Course detail: knowledge map (weighted topics + this user's mastery) and
  // uploaded materials.
  app.get("/api/courses/:id", { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const course = await prisma.course.findFirst({
      where: { id, userId: req.user.sub },
      include: { uploads: { orderBy: { createdAt: "desc" } } },
    });
    if (!course) return reply.code(404).send({ error: "Course not found" });

    const topics = await topicsWithMastery(req.user.sub, id);

    return reply.send({
      course: {
        id: course.id,
        name: course.name,
        icon: course.icon,
        mastery: courseMasteryPct(topics),
        topics: topics.map((t) => ({
          id: t.id,
          name: t.name,
          summary: t.summary,
          weight: Number(t.weight.toFixed(2)),
          mastery: Math.round(t.mastery * 100),
          due: t.attemptCount > 0 && t.due,
          attempted: t.attemptCount > 0,
          // Knowledge Layer 2.0 concept structure (Phase 6).
          difficulty: t.difficulty ?? null,
          objectives: t.objectives ?? [],
          misconceptions: t.misconceptions ?? [],
          prerequisites: t.prerequisites ?? [],
          sourceRef: t.sourceRef ?? null,
        })),
        uploads: course.uploads.map((u: Upload) => ({
          id: u.id,
          filename: u.filename,
          sizeBytes: u.sizeBytes,
          status: u.status,
          error: u.error,
          createdAt: u.createdAt,
        })),
      },
    });
  });

  // Rename / re-icon a course.
  app.patch("/api/courses/:id", { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = renameSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });

    const course = await prisma.course.findFirst({
      where: { id, userId: req.user.sub },
    });
    if (!course) return reply.code(404).send({ error: "Course not found" });

    const updated = await prisma.course.update({
      where: { id },
      data: parsed.data,
    });
    return reply.send({
      course: { id: updated.id, name: updated.name, icon: updated.icon },
    });
  });

  // Delete a course and everything derived from it.
  app.delete("/api/courses/:id", { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const course = await prisma.course.findFirst({
      where: { id, userId: req.user.sub },
    });
    if (!course) return reply.code(404).send({ error: "Course not found" });

    await prisma.course.delete({ where: { id } });
    return reply.send({ ok: true });
  });

  // Upload a course material (one file per request). Parses, moderates and
  // updates the map synchronously, then returns the new topic count.
  //
  // Adding material to an existing course is the same endpoint — the knowledge
  // map expands rather than being rebuilt (Step 2 item 6).
  app.post(
    "/api/courses/:id/uploads",
    {
      preHandler: [app.authenticate],
      // Each upload is a paid AI call plus PDF parsing — the global limit is
      // far too generous for this route.
      config: { rateLimit: { max: 20, timeWindow: "10 minutes" } },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const course = await prisma.course.findFirst({
        where: { id, userId: req.user.sub },
      });
      if (!course) return reply.code(404).send({ error: "Course not found" });

      const data = await req.file();
      if (!data) return reply.code(400).send({ error: "No file uploaded" });

      // Accept PDF/DOCX/PPTX documents, or an image of study material
      // (photo of notes, whiteboard, slide — 2.0 Phase 5)...
      const kind = kindFor(data.filename, data.mimetype);
      const imageKind = kind ? null : imageKindFor(data.filename, data.mimetype);
      if (!kind && !imageKind) {
        return reply.code(415).send({
          error:
            "Only PDF, DOCX, PPTX, or an image (PNG, JPG, WebP) of your notes is supported.",
        });
      }

      const buffer = await data.toBuffer();

      // ...and only when the bytes agree. Extension and mimetype are both
      // client-chosen; the leading bytes are the one part a disguised file
      // can't fake while still parsing (security review item).
      const bytesAgree = kind
        ? matchesSignature(kind, buffer)
        : matchesImageSignature(imageKind!, buffer);
      if (!bytesAgree) {
        const label = kind ? kind.toUpperCase() : "image";
        return reply.code(415).send({
          error: `That file doesn't look like a real ${label} — it may be renamed or corrupted.`,
        });
      }

      // Images travel base64-encoded to the vision provider in one request,
      // so they get a tighter cap than documents.
      if (imageKind && buffer.byteLength > env.MAX_IMAGE_MB * 1024 * 1024) {
        return reply.code(413).send({
          error: `Images are capped at ${env.MAX_IMAGE_MB}MB — try a smaller photo.`,
        });
      }

      // Guest caps (PATHWISE 2.0 Phase 1): smaller files, fewer of them.
      if (await isGuestUser(req.user.sub)) {
        if (guestFileTooLarge(buffer.byteLength, env.GUEST_MAX_FILE_MB)) {
          return reply.code(413).send({
            error: "guest_limit",
            message: `Guest uploads are capped at ${env.GUEST_MAX_FILE_MB}MB per file. Create a free account for bigger files.`,
          });
        }
        const uploadCount = await prisma.upload.count({
          where: { course: { userId: req.user.sub } },
        });
        if (!guestMayUpload(uploadCount, env.GUEST_UPLOAD_CAP)) {
          return reply.code(403).send({
            error: "guest_limit",
            message: `Guests can upload ${env.GUEST_UPLOAD_CAP} files. Create a free account to keep going — everything you've done comes with you.`,
          });
        }
      }

      const saved = await storage.save(req.user.sub, data.filename, buffer);

      const upload = await prisma.upload.create({
        data: {
          courseId: id,
          filename: data.filename,
          storagePath: saved.storagePath,
          mimeType: data.mimetype,
          sizeBytes: saved.sizeBytes,
        },
      });

      await track(req.user.sub, "upload_started", {
        courseId: id,
        uploadId: upload.id,
        sizeBytes: saved.sizeBytes,
      });

      let result;
      try {
        result = await processUpload(upload.id, req.user.sub);
      } catch (err) {
        if (err instanceof AIBudgetExceededError) {
          // Don't leave the row stuck in "parsing" — the student can retry
          // tomorrow, and the card should say why it stopped.
          await prisma.upload.update({
            where: { id: upload.id },
            data: { status: "failed", error: err.message },
          }).catch(() => {});
          return reply.code(429).send({ error: err.message });
        }
        throw err;
      }

      // A rejected file is a client problem (wrong kind of document), so it
      // gets a 4xx — the frontend shows the reason rather than a generic error.
      const status = result.status === "rejected" ? 422 : 201;

      return reply.code(status).send({
        upload: {
          id: upload.id,
          filename: upload.filename,
          sizeBytes: upload.sizeBytes,
          status: result.status,
          error: result.error ?? null,
        },
        topicCount: result.topicCount,
        newTopicCount: result.newTopicCount ?? 0,
      });
    }
  );

  // Remove one uploaded material. Topics it contributed stay — they may have
  // been reinforced by other files, and mastery is attached to them.
  app.delete(
    "/api/courses/:id/uploads/:uploadId",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { id, uploadId } = req.params as { id: string; uploadId: string };
      const upload = await prisma.upload.findFirst({
        where: { id: uploadId, courseId: id, course: { userId: req.user.sub } },
      });
      if (!upload) return reply.code(404).send({ error: "Upload not found" });

      await prisma.upload.delete({ where: { id: uploadId } });
      // Remove the stored file too — a deleted upload shouldn't keep paying
      // for storage. Best-effort: the DB row is authoritative either way.
      await storage.remove(upload.storagePath).catch((err) => {
        req.log.warn({ err, uploadId }, "failed to remove stored file");
      });
      return reply.send({ ok: true });
    }
  );
}
