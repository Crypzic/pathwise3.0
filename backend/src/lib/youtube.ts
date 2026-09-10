// YouTube Data API v3 integration (2.0 frontend spec, section 3).
//
// Two jobs: (1) learner search — free text → AI academic-intent refinement →
// YouTube search; (2) interest-mapped suggestions — queries derived from the
// learner's onboarding subjects/field and course topics, never generic.
//
// The key stays server-side (YOUTUBE_API_KEY); the frontend only ever talks
// to our API. Results are cached in-memory per query for an hour — search
// costs 100 quota units of the 10k/day default, so cache hits matter.
// Without a key this module returns [] and the Videos surface falls back to
// the curated catalog.
import { env } from "./env.js";

export interface YouTubeVideo {
  videoId: string;
  title: string;
  channel: string;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  url: string;
}

const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { at: number; items: YouTubeVideo[] }>();

export function youtubeConfigured(): boolean {
  return env.YOUTUBE_API_KEY.length > 0;
}

/** Search YouTube for educational videos. Cached; [] when unconfigured. */
export async function searchYouTube(
  query: string,
  maxResults = 12
): Promise<YouTubeVideo[]> {
  if (!youtubeConfigured()) return [];
  const q = query.trim().slice(0, 200);
  if (q.length < 2) return [];

  const key = `${q.toLowerCase()}#${maxResults}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.items;

  const params = new URLSearchParams({
    part: "snippet",
    type: "video",
    maxResults: String(Math.min(25, Math.max(1, maxResults))),
    q,
    safeSearch: "strict",
    videoEmbeddable: "true",
    relevanceLanguage: "en",
    key: env.YOUTUBE_API_KEY,
  });

  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/search?${params}`,
    { signal: AbortSignal.timeout(15_000) }
  );
  if (!res.ok) {
    // Quota exhaustion or a bad key must degrade, not break the page.
    const body = await res.text().catch(() => "");
    console.warn(`⚠️  YouTube search failed (${res.status}): ${body.slice(0, 200)}`);
    return [];
  }

  const data = (await res.json()) as {
    items?: {
      id?: { videoId?: string };
      snippet?: {
        title?: string;
        channelTitle?: string;
        publishedAt?: string;
        thumbnails?: { medium?: { url?: string }; default?: { url?: string } };
      };
    }[];
  };

  const items: YouTubeVideo[] = (data.items ?? [])
    .filter((i) => i.id?.videoId && i.snippet?.title)
    .map((i) => ({
      videoId: i.id!.videoId!,
      title: decodeEntities(i.snippet!.title!),
      channel: i.snippet?.channelTitle ?? "YouTube",
      thumbnailUrl:
        i.snippet?.thumbnails?.medium?.url ??
        i.snippet?.thumbnails?.default?.url ??
        null,
      publishedAt: i.snippet?.publishedAt ?? null,
      url: `https://www.youtube.com/watch?v=${i.id!.videoId!}`,
    }));

  cache.set(key, { at: Date.now(), items });
  return items;
}

/** YouTube titles arrive HTML-entity-encoded. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// suggestionQueries (pure, unit-tested) lives in videoModel.ts and is
// re-exported here for callers thinking in YouTube terms.
export { suggestionQueries } from "./videoModel.js";
