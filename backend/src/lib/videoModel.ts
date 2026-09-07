// Curated Educational Videos (PATHWISE 2.0 Phase 14) — pure rules.
// Ranking matches a learner's derived signals (topic names, subjects)
// against video metadata; validation guards the ops write path.
import { overlap } from "./matchModel.js";

export interface VideoRecord {
  id: string;
  title: string;
  creator: string;
  url: string;
  thumbnailUrl: string | null;
  subject: string;
  topics: string[];
  difficulty: number | null;
  durationSec: number | null;
}

export interface LearnerVideoSignals {
  /** Topic names from the learner's knowledge maps. */
  courseTopics: string[];
  /** Self-declared subjects + topics of interest. */
  subjects: string[];
  topicsOfInterest: string[];
}

export interface RankedVideo {
  video: VideoRecord;
  score: number;
  reason: string | null;
}

const fold = (s: string) => s.trim().toLowerCase();

/**
 * Relevance for the curated shelf: shared topics dominate, subject affinity
 * fills in, and unmatched videos still surface (score 0) so a new account
 * sees a catalog rather than a void.
 */
export function rankVideos(
  me: LearnerVideoSignals,
  videos: VideoRecord[]
): RankedVideo[] {
  const mySubjects = new Set(me.subjects.map(fold));
  const myTopics = [...me.courseTopics, ...me.topicsOfInterest];

  return videos
    .map((video) => {
      const sharedTopics = overlap(video.topics, myTopics);
      const subjectHit = mySubjects.has(fold(video.subject));
      const score =
        Math.min(1, sharedTopics.length / 2) * 0.7 + (subjectHit ? 0.3 : 0);
      let reason: string | null = null;
      if (sharedTopics.length > 0) {
        reason = `Matches ${sharedTopics.slice(0, 2).join(" and ")} in your courses`;
      } else if (subjectHit) {
        reason = `You study ${video.subject}`;
      }
      return { video, score, reason };
    })
    .sort((a, b) => b.score - a.score);
}

/** Validate an ops-submitted video. Returns the error, or null when fine. */
export function validateVideoInput(v: {
  title?: unknown;
  creator?: unknown;
  url?: unknown;
  subject?: unknown;
}): string | null {
  if (typeof v.title !== "string" || v.title.trim().length < 3) {
    return "title needs at least 3 characters";
  }
  if (typeof v.creator !== "string" || v.creator.trim().length < 2) {
    return "creator is required";
  }
  if (typeof v.subject !== "string" || v.subject.trim().length < 2) {
    return "subject is required";
  }
  if (typeof v.url !== "string" || !/^https?:\/\/.+\..+/.test(v.url.trim())) {
    return "url must be a valid http(s) link";
  }
  return null;
}

/**
 * Starter catalog: widely-known, stable educational sources. Deliberately
 * conservative — only famous videos whose links are load-bearing classics,
 * plus official channel/playlist pages that can't rot into the wrong
 * content. Editors grow the catalog through the ops endpoints. The url is
 * the seed identity: re-seeding matches on it and never duplicates.
 */
export interface VideoSeed {
  title: string;
  creator: string;
  url: string;
  thumbnailUrl?: string;
  subject: string;
  topics: string[];
  difficulty?: number;
  durationSec?: number;
}

export const DEFAULT_VIDEOS: VideoSeed[] = [
  {
    title: "But what is a neural network?",
    creator: "3Blue1Brown",
    url: "https://www.youtube.com/watch?v=aircAruvnKk",
    thumbnailUrl: "https://img.youtube.com/vi/aircAruvnKk/hqdefault.jpg",
    subject: "Computer Science",
    topics: ["Neural Networks", "Machine Learning", "AI"],
    difficulty: 0.45,
    durationSec: 1155,
  },
  {
    title: "Vectors | Chapter 1, Essence of linear algebra",
    creator: "3Blue1Brown",
    url: "https://www.youtube.com/watch?v=fNk_zzaMoSs",
    thumbnailUrl: "https://img.youtube.com/vi/fNk_zzaMoSs/hqdefault.jpg",
    subject: "Mathematics",
    topics: ["Vectors", "Linear Algebra"],
    difficulty: 0.4,
    durationSec: 590,
  },
  {
    title: "The Immune System Explained - Bacteria Infection",
    creator: "Kurzgesagt - In a Nutshell",
    url: "https://www.youtube.com/watch?v=zQGOcOUBi6s",
    thumbnailUrl: "https://img.youtube.com/vi/zQGOcOUBi6s/hqdefault.jpg",
    subject: "Biology",
    topics: ["Immune System", "Bacteria", "Immunology"],
    difficulty: 0.3,
    durationSec: 425,
  },
  {
    title: "What is computation? (MIT 6.0001, Lecture 1)",
    creator: "MIT OpenCourseWare",
    url: "https://www.youtube.com/watch?v=nykOeWgQcHM",
    thumbnailUrl: "https://img.youtube.com/vi/nykOeWgQcHM/hqdefault.jpg",
    subject: "Computer Science",
    topics: ["Programming", "Python", "Computation"],
    difficulty: 0.25,
    durationSec: 2680,
  },
  {
    title: "Crash Course Biology (series)",
    creator: "CrashCourse",
    url: "https://www.youtube.com/playlist?list=PL3EED4C1D684D3ADF",
    subject: "Biology",
    topics: ["Cell Biology", "Genetics", "Evolution"],
    difficulty: 0.3,
  },
  {
    title: "Crash Course Psychology (series)",
    creator: "CrashCourse",
    url: "https://www.youtube.com/playlist?list=PL8dPuuaLjXtOPRKzVLY0jJY-uHOH9KVU6",
    subject: "Psychology",
    topics: ["Psychology", "Behavior", "Cognition"],
    difficulty: 0.3,
  },
  {
    title: "Khan Academy Chemistry (course)",
    creator: "Khan Academy",
    url: "https://www.khanacademy.org/science/chemistry",
    subject: "Chemistry",
    topics: ["Atoms", "Chemical Bonds", "Reactions"],
    difficulty: 0.35,
  },
  {
    title: "Khan Academy Microeconomics (course)",
    creator: "Khan Academy",
    url: "https://www.khanacademy.org/economics-finance-domain/microeconomics",
    subject: "Business",
    topics: ["Economics", "Supply And Demand", "Markets"],
    difficulty: 0.35,
  },
  {
    title: "MIT 8.01 Classical Mechanics (course)",
    creator: "MIT OpenCourseWare",
    url: "https://ocw.mit.edu/courses/8-01sc-classical-mechanics-fall-2016/",
    subject: "Physics",
    topics: ["Mechanics", "Newton's Laws", "Kinematics"],
    difficulty: 0.5,
  },
];
