// Home "Chat with Pathwise" (UX overhaul Phase 5).
//
// A dedicated AI chat with no course required: brutally honest, lightly
// Socratic. The + button uploads a PDF/DOCX/PPTX/image which is parsed to
// text and handed BACK to the client — the client includes it with each
// message, so the server stays stateless (no new tables, nothing to sweep).
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../lib/env.js";
import { extractText, imageKindFor, kindFor, IMAGE_MIME } from "../lib/parse.js";
import { matchesImageSignature, matchesSignature } from "../lib/fileSignature.js";
import {
  AIBudgetExceededError,
  askReply,
  transcribeImage,
} from "../lib/aiMeter.js";
import { AIUnavailableError } from "../ai/resilience.js";
import { track } from "../lib/analytics.js";
import type { ChatMessage } from "../ai/index.js";

const ATTACHMENT_CHARS = 14000;

const chatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      })
    )
    .min(1)
    .max(24),
  attachmentText: z.string().max(ATTACHMENT_CHARS + 100).optional(),
  attachmentName: z.string().max(200).optional(),
});

const TONE =
  "You are Pathwise, a brutally honest study companion. Be direct about " +
  "what the student clearly doesn't understand yet — no empty praise, no " +
  "hedging. Be concrete and useful. Stay lightly Socratic: when a guiding " +
  "question would genuinely move their understanding forward, ask it; " +
  "otherwise answer plainly. Keep replies tight.";

export default async function chatRoutes(app: FastifyInstance) {
  // Parse an attached document/image to text. Synchronous and bounded —
  // the user is actively waiting to chat about it.
  app.post(
    "/api/chat/attach",
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 10, timeWindow: "10 minutes" } },
    },
    async (req, reply) => {
      const data = await req.file();
      if (!data) return reply.code(400).send({ error: "No file uploaded" });

      const kind = kindFor(data.filename, data.mimetype);
      const imageKind = kind ? null : imageKindFor(data.filename, data.mimetype);
      if (!kind && !imageKind) {
        return reply.code(415).send({
          error: "Only PDF, DOCX, PPTX, or an image (PNG, JPG, WebP) is supported.",
        });
      }
      const buffer = await data.toBuffer();
      const bytesAgree = kind
        ? matchesSignature(kind, buffer)
        : matchesImageSignature(imageKind!, buffer);
      if (!bytesAgree) {
        return reply.code(415).send({
          error: "That file doesn't look like what its name claims — it may be renamed or corrupted.",
        });
      }
      if (imageKind && buffer.byteLength > env.MAX_IMAGE_MB * 1024 * 1024) {
        return reply.code(413).send({
          error: `Images are capped at ${env.MAX_IMAGE_MB}MB — try a smaller photo.`,
        });
      }

      try {
        const text = imageKind
          ? await transcribeImage(req.user.sub, "Pathwise chat", {
              data: buffer,
              mimeType: IMAGE_MIME[imageKind],
            })
          : await extractText(buffer, data.filename, data.mimetype);
        const trimmed = text.trim();
        if (trimmed.length === 0) {
          return reply.code(422).send({
            error: "Couldn't read any text out of that file — try a clearer copy.",
          });
        }
        await track(req.user.sub, "chat_attachment_parsed", {
          chars: trimmed.length,
        });
        return reply.send({
          filename: data.filename,
          chars: trimmed.length,
          text: trimmed.slice(0, ATTACHMENT_CHARS),
          truncated: trimmed.length > ATTACHMENT_CHARS,
        });
      } catch (err) {
        if (err instanceof AIBudgetExceededError) {
          return reply.code(429).send({ error: err.message });
        }
        const message =
          err instanceof Error ? err.message : "Couldn't read that file.";
        return reply.code(422).send({ error: message });
      }
    }
  );

  // One chat turn. History travels with the request; the reply comes back.
  app.post(
    "/api/chat",
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 60, timeWindow: "10 minutes" } },
    },
    async (req, reply) => {
      const parsed = chatSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid chat payload" });
      }
      const { messages, attachmentText, attachmentName } = parsed.data;

      const grounding = [
        TONE,
        attachmentText
          ? `THE STUDENT'S UPLOADED DOCUMENT${attachmentName ? ` (${attachmentName})` : ""}:\n${attachmentText}`
          : null,
      ]
        .filter(Boolean)
        .join("\n\n");

      try {
        const answer = await askReply(
          req.user.sub,
          "Pathwise chat",
          attachmentName ?? "whatever the student brings",
          messages as ChatMessage[],
          grounding
        );
        await track(req.user.sub, "home_chat_turn", {
          withAttachment: Boolean(attachmentText),
        });
        return reply.send({ reply: answer });
      } catch (err) {
        if (err instanceof AIBudgetExceededError) {
          return reply.code(429).send({ error: err.message });
        }
        if (err instanceof AIUnavailableError) {
          return reply.code(503).send({ error: err.message });
        }
        throw err;
      }
    }
  );
}
