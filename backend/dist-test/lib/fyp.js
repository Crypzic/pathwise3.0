// FYP signal assembly (PATHWISE 2.0 Phase 15). Pure ranking lives in
// fypModel.ts; this gathers one learner's derived context — profile,
// topics + mastery, engagement history — and never touches file contents.
import { prisma } from "./prisma.js";
import { parseStoredList } from "./onboardingModel.js";
import { rankFeed, quizTarget } from "./fypModel.js";
const WEAK_MASTERY = 0.4;
export async function buildFeed(userId) {
    const [profile, topics, engagements, videos] = await Promise.all([
        prisma.learnerProfile.findUnique({ where: { userId } }),
        prisma.topic.findMany({
            where: { knowledgeMap: { course: { userId } } },
            select: {
                id: true,
                name: true,
                knowledgeMap: { select: { courseId: true } },
                masteries: { where: { userId }, select: { mastery: true } },
            },
        }),
        prisma.videoEngagement.findMany({
            where: { userId },
            select: { videoId: true, kind: true },
        }),
        prisma.curatedVideo.findMany({ where: { status: "published" } }),
    ]);
    const topicRows = topics.map((t) => ({
        topicId: t.id,
        courseId: t.knowledgeMap.courseId,
        name: t.name,
        mastery: t.masteries[0]?.mastery ?? 0,
    }));
    const records = videos.map((v) => ({
        id: v.id,
        title: v.title,
        creator: v.creator,
        url: v.url,
        thumbnailUrl: v.thumbnailUrl,
        subject: v.subject,
        topics: parseStoredList(v.topicsJson),
        difficulty: v.difficulty,
        durationSec: v.durationSec,
    }));
    const byId = new Map(records.map((r) => [r.id, r]));
    const likedIds = engagements
        .filter((e) => e.kind === "like" || e.kind === "save")
        .map((e) => e.videoId);
    const likedTopics = likedIds.flatMap((id) => byId.get(id)?.topics ?? []);
    const likedSubjects = likedIds
        .map((id) => byId.get(id)?.subject)
        .filter((s) => Boolean(s));
    const ranked = rankFeed({
        courseTopics: topicRows.map((t) => t.name),
        weakTopics: topicRows
            .filter((t) => t.mastery < WEAK_MASTERY)
            .map((t) => t.name),
        subjects: profile ? parseStoredList(profile.subjectsJson) : [],
        topicsOfInterest: profile ? parseStoredList(profile.topicsJson) : [],
        communityInterests: profile
            ? parseStoredList(profile.communityInterestsJson)
            : [],
        likedTopics,
        likedSubjects,
        watchedVideoIds: engagements
            .filter((e) => e.kind === "view")
            .map((e) => e.videoId),
    }, records);
    // The learning bridge: attach "quiz yourself on X" wherever the video
    // maps onto one of the learner's own topics.
    return ranked.map((item) => ({
        ...item,
        action: quizTarget(item.video, topicRows),
    }));
}
