// Direct Messaging (PATHWISE 2.0 Phase 12) — pure rules.

/**
 * Canonical participant order for the one-conversation-per-pair unique:
 * always (lower id, higher id), so (x,y) and (y,x) hit the same row.
 */
export function pairKey(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x];
}

/** May `senderId` post into a conversation in this state? */
export function canSend(
  conversation: { status: string; requesterId: string },
  senderId: string
): { ok: boolean; reason?: string } {
  if (conversation.status === "active") return { ok: true };
  if (conversation.status === "declined") {
    return { ok: false, reason: "This conversation was declined." };
  }
  // Pending: the requester may add to their message request (bounded by the
  // route's rate limit); the recipient replies by accepting instead.
  if (conversation.requesterId === senderId) return { ok: true };
  return {
    ok: false,
    reason: "Accept the message request to reply.",
  };
}
