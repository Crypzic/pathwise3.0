// Study Buddy Rooms (PATHWISE 2.0 Phases 11/19) — pure rules.
/** A help request goes stale after this long without the partner joining. */
export const HELP_WINDOW_MS = 10 * 60 * 1000;
/**
 * The facilitator speaks only when BOTH participants have asked recently.
 * One-sided requests wait; stale ones don't count. This is the roadmap's
 * "intervene when both learners request help" rule as a pure function.
 */
export function bothWantHelp(helpAAt, helpBAt, now = new Date()) {
    if (!helpAAt || !helpBAt)
        return false;
    return (now.getTime() - helpAAt.getTime() <= HELP_WINDOW_MS &&
        now.getTime() - helpBAt.getTime() <= HELP_WINDOW_MS);
}
/** Is a single help request still fresh? */
export function helpActive(at, now = new Date()) {
    return Boolean(at && now.getTime() - at.getTime() <= HELP_WINDOW_MS);
}
/** Which help column does this participant own? */
export function helpFieldFor(room, userId) {
    if (room.aId === userId)
        return "helpAAt";
    if (room.bId === userId)
        return "helpBAt";
    return null;
}
