// The @pathwise chat assistant (messaging overhaul Phase 2.4).
//
// Typing "@pathwise …" in a DM or Study Room summons the AI into the
// conversation. It answers as a reserved SYSTEM user row (so every FK and
// render path works unchanged) with the recent messages as context, and the
// reply is generated through the metered askReply pipeline — same budget
// caps, same provider routing, same resilience as Ask PATHWISE.
import { prisma } from "./prisma.js";
import { askReply } from "./aiMeter.js";
import type { ChatMessage } from "../ai/index.js";

const BOT_EMAIL = "assistant@pathwise.internal";
export const BOT_NAME = "Pathwise";

export function mentionsPathwise(body: string): boolean {
  return /@pathwise\b/i.test(body);
}

let cachedId: string | null = null;

/** The singleton assistant identity — created on first use, then cached. */
export async function pathwiseBotId(): Promise<string> {
  if (cachedId) return cachedId;
  const existing = await prisma.user.findUnique({
    where: { email: BOT_EMAIL },
    select: { id: true },
  });
  if (existing) {
    cachedId = existing.id;
    return existing.id;
  }
  const created = await prisma.user.create({
    data: {
      email: BOT_EMAIL,
      // Never a valid bcrypt hash — this identity cannot sign in.
      passwordHash: "!system-account",
      name: BOT_NAME,
      isSystem: true,
      privacyAcceptedAt: new Date(),
      notifyEmail: false,
      notifyStreak: false,
      notifyReviewDue: false,
      notifyUnlocks: false,
    },
    select: { id: true },
  });
  cachedId = created.id;
  return created.id;
}

export interface ChatContextMessage {
  authorName: string;
  body: string;
  fromBot: boolean;
}

/**
 * Generate the assistant's reply from recent conversation context.
 * `topicName`/`grounding` tie it to shared study material when the chat has
 * one; otherwise it's a general, lightly-Socratic study companion.
 */
/**
 * Background responder for DMs: read recent context, generate, post as the
 * bot. Failures post a short, honest fallback instead of silent absence.
 */
export async function respondInDm(
  conversationId: string,
  billedUserId: string
): Promise<void> {
  const botId = await pathwiseBotId();
  const msgs = await prisma.directMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: 12,
    include: { sender: { select: { id: true, name: true, username: true } } },
  });
  const context: ChatContextMessage[] = msgs.reverse().map((m) => ({
    authorName: m.sender.username ?? m.sender.name,
    body: m.body,
    fromBot: m.senderId === botId,
  }));

  let body: string;
  try {
    body = await pathwiseReply(billedUserId, context);
  } catch (err) {
    body =
      err instanceof Error && /budget/i.test(err.message)
        ? err.message
        : "I couldn't think that one through just now — mention me again in a moment.";
  }
  const created = await prisma.directMessage.create({
    data: { conversationId, senderId: botId, body },
  });
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: created.createdAt },
  });
}

/** Background responder for Study Rooms — posts as the room's facilitator
 *  lane (null sender, role "assistant"), grounded in the room's focus topic. */
export async function respondInRoom(
  roomId: string,
  billedUserId: string,
  topicName: string | null
): Promise<void> {
  const msgs = await prisma.studyRoomMessage.findMany({
    where: { roomId },
    orderBy: { createdAt: "desc" },
    take: 12,
    include: { sender: { select: { name: true, username: true } } },
  });
  const context: ChatContextMessage[] = msgs.reverse().map((m) => ({
    authorName: m.sender ? (m.sender.username ?? m.sender.name) : BOT_NAME,
    body: m.content,
    fromBot: m.role === "assistant",
  }));

  let body: string;
  try {
    body = await pathwiseReply(
      billedUserId,
      context,
      topicName,
      topicName
        ? `Two study buddies are working on "${topicName}" and summoned you with @pathwise. Be helpful and concrete; a guiding question is good, stonewalling is not.`
        : undefined
    );
  } catch (err) {
    body =
      err instanceof Error && /budget/i.test(err.message)
        ? err.message
        : "I couldn't think that one through just now — mention me again in a moment.";
  }
  await prisma.studyRoomMessage.create({
    data: { roomId, senderId: null, role: "assistant", content: body },
  });
}

export async function pathwiseReply(
  billedUserId: string,
  context: ChatContextMessage[],
  topicName?: string | null,
  grounding?: string
): Promise<string> {
  const history: ChatMessage[] = context.map((m) => ({
    role: m.fromBot ? "assistant" : "user",
    content: m.fromBot ? m.body : `${m.authorName}: ${m.body}`,
  }));
  return askReply(
    billedUserId,
    "Study chat",
    topicName?.trim() || "whatever the group is studying",
    history,
    grounding?.trim() ||
      "This is a study conversation between learners. You were summoned with @pathwise. Be helpful, honest and concrete; nudge with a guiding question when it helps understanding, but answer what was actually asked."
  );
}
