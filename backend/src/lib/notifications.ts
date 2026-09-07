// Notifications (Step 12).
//
// Three types, all fixed-trigger — smart/behavioural timing is explicitly out
// of scope:
//   1. Streak reminder   — once daily at the user's chosen local hour
//   2. Review due        — when the spaced-repetition scheduler has work
//   3. Rank/badge unlock — immediately on unlock
//
// Delivery is in-app (the NotificationLog table, polled by the client) plus —
// for the daily streak/review reminders — email, when the user's notifyEmail
// pref allows. Email is the channel that can actually bring someone back:
// an in-app notification is only seen once they've already opened the app.
// Unlocks stay in-app only; an email per badge would be spam.
import { prisma } from "./prisma.js";
import { env } from "./env.js";
import { email } from "../email/index.js";
import { localDayKey } from "./gamification.js";
import { isDue } from "./mastery.js";
import { track } from "./analytics.js";
import { removeUserStoredFiles } from "./storageSweep.js";

// "buddy": study-buddy requests/acceptances (PATHWISE 2.0 Phase 10).
export type NotificationKind =
  | "streak_reminder"
  | "review_due"
  | "unlock"
  | "buddy";

export interface Notification {
  kind: NotificationKind;
  title: string;
  body: string;
  deepLink?: string;
}

/**
 * Persist a notification for a user.
 *
 * The (userId, kind, dayKey) unique constraint is what makes this idempotent:
 * a cron that runs every 15 minutes can call this freely and each kind still
 * fires at most once per local day. Unlocks pass a unique dayKey suffix so
 * several badges on the same day all land.
 */
export async function deliver(
  userId: string,
  notification: Notification,
  dayKey: string
): Promise<boolean> {
  try {
    await prisma.notificationLog.create({
      data: {
        userId,
        kind: notification.kind,
        title: notification.title,
        body: notification.body,
        deepLink: notification.deepLink ?? null,
        dayKey,
      },
    });
    await track(userId, "notification_sent", { kind: notification.kind });
    return true;
  } catch {
    // Unique-constraint violation = already sent today. Not an error.
    return false;
  }
}

/** Rank-up / badge unlock (Step 12 item 3). Fires immediately, not on a cron. */
export async function notifyUnlock(
  userId: string,
  title: string,
  body: string
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { notifyUnlocks: true, timezone: true },
  });
  if (!user?.notifyUnlocks) return;

  // Suffix keeps multiple same-day unlocks distinct.
  const dayKey = `${localDayKey(user.timezone)}#${title.slice(0, 40)}`;
  await deliver(userId, { kind: "unlock", title, body, deepLink: "/profile" }, dayKey);
}

/** Local hour (0-23) for a user right now. */
function localHour(timezone: string, at: Date = new Date()): number {
  try {
    const hour = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      hour12: false,
    }).format(at);
    return Number(hour);
  } catch {
    return at.getUTCHours();
  }
}

export interface SweepResult {
  streakReminders: number;
  reviewReminders: number;
  emailsSent: number;
  usersChecked: number;
}

/**
 * Best-effort email copy of a delivered notification. Failure is logged and
 * swallowed — one bounced address must never abort the whole sweep.
 */
async function emailCopy(
  to: string,
  notification: Notification
): Promise<boolean> {
  try {
    await email.sendNotification({
      to,
      subject: notification.title,
      body: notification.body,
      actionUrl: `${env.APP_URL}${notification.deepLink ?? "/courses"}`,
      actionLabel: "Open Pathwise",
    });
    return true;
  } catch (err) {
    console.error(`⚠️  Failed to email notification to ${to}:`, err);
    return false;
  }
}

/**
 * The scheduled sweep. Meant to be called every 15-30 minutes by an external
 * cron (see routes/cron.ts) — each user is only notified when their own local
 * clock has reached their configured hour, which is how one global job
 * respects per-user timezones.
 */
export async function runNotificationSweep(now = new Date()): Promise<SweepResult> {
  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      email: true,
      timezone: true,
      notifyStreak: true,
      notifyReviewDue: true,
      notifyEmail: true,
      notifyHour: true,
      streakCount: true,
      lastActiveDay: true,
      streakFreezes: true,
    },
  });

  let streakReminders = 0;
  let reviewReminders = 0;
  let emailsSent = 0;

  for (const user of users) {
    const hour = localHour(user.timezone, now);
    // A sweep can run a little late; accept the configured hour or the one
    // after so a missed tick doesn't skip the whole day.
    if (hour !== user.notifyHour && hour !== user.notifyHour + 1) continue;

    const dayKey = localDayKey(user.timezone, now);

    // 1. Streak reminder — only if they haven't studied today.
    if (user.notifyStreak && user.lastActiveDay !== dayKey) {
      const notification: Notification = {
        kind: "streak_reminder",
        title: "Keep your streak",
        body:
          user.streakCount > 0
            ? `Your ${user.streakCount}-day streak is still alive — a few minutes keeps it going.`
            : "A short session today is enough to start a streak.",
        deepLink: "/courses",
      };
      const sent = await deliver(user.id, notification, dayKey);
      if (sent) {
        streakReminders += 1;
        // The dedupe key already fired, so the email goes at most once/day too.
        if (user.notifyEmail && (await emailCopy(user.email, notification))) {
          emailsSent += 1;
        }
      }
    }

    // 2. Review-due reminder, straight from the scheduler.
    if (user.notifyReviewDue) {
      const masteries = await prisma.topicMastery.findMany({
        where: { userId: user.id, attemptCount: { gt: 0 } },
        select: { dueAt: true, topic: { select: { knowledgeMap: { select: { courseId: true } } } } },
      });
      const dueRows = masteries.filter((m) => isDue(m.dueAt, now));

      if (dueRows.length > 0) {
        const courseId = dueRows[0].topic.knowledgeMap.courseId;
        const notification: Notification = {
          kind: "review_due",
          title:
            dueRows.length === 1
              ? "1 topic is due for review"
              : `${dueRows.length} topics are due for review`,
          body: "A quick review now is worth an hour of cramming later.",
          deepLink: `/study-plan/${courseId}`,
        };
        const sent = await deliver(user.id, notification, dayKey);
        if (sent) {
          reviewReminders += 1;
          if (user.notifyEmail && (await emailCopy(user.email, notification))) {
            emailsSent += 1;
          }
        }
      }
    }
  }

  return { streakReminders, reviewReminders, emailsSent, usersChecked: users.length };
}

/**
 * Hard-delete users whose 30-day recovery window has expired (Step 10 item 3).
 * Sweeps their stored files first (GDPR — deletion means the files too, not
 * just the rows); DB cascades handle every child row.
 */
export async function purgeExpiredAccounts(now = new Date()): Promise<number> {
  const expired = await prisma.user.findMany({
    where: { deletedAt: { not: null }, purgeAfter: { lt: now } },
    select: { id: true },
  });
  for (const user of expired) {
    await removeUserStoredFiles(user.id);
    await prisma.user.delete({ where: { id: user.id } });
  }
  return expired.length;
}
