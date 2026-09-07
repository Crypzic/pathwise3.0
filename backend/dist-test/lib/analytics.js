// Product analytics for the Success Metrics (Step 16 item 4).
//
// Deliberately a plain table rather than a third-party SDK: the metrics we care
// about at launch (activation, upload completion, quiz completion, retention,
// mastery growth, premium conversion) are all answerable with SQL, and this
// avoids shipping user data to another vendor before the privacy review.
import { prisma } from "./prisma.js";
/**
 * Record an event. Never throws — analytics must not be able to fail a request.
 */
export async function track(userId, name, props = {}) {
    try {
        await prisma.analyticsEvent.create({
            data: { userId, name, propsJson: JSON.stringify(props) },
        });
    }
    catch (err) {
        console.error(`⚠️  analytics: failed to record ${name}`, err);
    }
}
/** The activation funnel, for the ops dashboard. */
export async function funnel(sinceDays = 30) {
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
    const rows = await prisma.analyticsEvent.groupBy({
        by: ["name"],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
    });
    const count = (n) => rows.find((r) => r.name === n)?._count._all ?? 0;
    return {
        signups: count("signup"),
        privacyAccepted: count("privacy_accepted"),
        coursesCreated: count("course_created"),
        uploadsCompleted: count("upload_completed"),
        quizzesCompleted: count("quiz_completed"),
        premiumActivated: count("premium_activated"),
    };
}
