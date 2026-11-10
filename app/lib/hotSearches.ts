import { prisma } from './prisma';
import {
  interleaveSocialSearches, isWithinAge, normalizeSocialKeyword, parseSocialHotSearches,
  type SocialSource, type Suggestion,
} from './discovery';

const FRESH_MS = 30 * 60_000;
const MAX_AGE_MS = 24 * 60 * 60_000;
const DEFAULT_API_BASE = 'https://newsnow.busiyi.world';
const PLATFORMS = [
  { source: 'weibo', id: 'weibo' },
  { source: 'bilibili', id: 'bilibili-hot-search' },
  { source: 'douyin', id: 'douyin' },
] as const;

interface Snapshot { items: Suggestion[]; fetchedAt: Date }
interface Feed {
  source: SocialSource;
  id: string;
  snapshot: Snapshot | null;
  pending: Promise<Suggestion[]> | null;
  retryAfter: number;
}

const feeds = PLATFORMS.map((platform): Feed => ({
  ...platform, snapshot: null, pending: null, retryAfter: 0,
}));

function available(feed: Feed, maxAge: number): Suggestion[] | undefined {
  if (!feed.snapshot || !isWithinAge(feed.snapshot.fetchedAt, maxAge)) return;
  const fetchedAt = feed.snapshot.fetchedAt.toISOString();
  return feed.snapshot.items.map(item => ({ ...item, fetchedAt }));
}

async function loadSnapshot(feed: Feed) {
  if (feed.snapshot || !process.env.POSTGRES_PRISMA_URL) return;
  try {
    const saved = await prisma.hotSearchSnapshot.findUnique({ where: { source: feed.source } });
    if (!saved || !isWithinAge(saved.fetchedAt, MAX_AGE_MS) || !Array.isArray(saved.items)) return;
    const items = saved.items.flatMap(item => {
      const path = item && typeof item === 'object' && !Array.isArray(item) ? normalizeSocialKeyword(item.path) : null;
      return path ? [{ path, source: feed.source }] : [];
    });
    if (items.length) feed.snapshot = { items, fetchedAt: saved.fetchedAt };
  } catch { /* Public feeds can run without database snapshots. */ }
}

async function fetchFeed(feed: Feed): Promise<Suggestion[]> {
  const url = new URL('/api/s', process.env.SOCIAL_HOT_SEARCH_API_BASE_URL?.trim() || DEFAULT_API_BASE);
  url.searchParams.set('id', feed.id);
  const response = await fetch(url, {
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(6000),
    headers: { Accept: 'application/json' },
  });
  if (!response.ok || !response.body) throw new Error('热词来源暂不可用');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let json = '', bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 2_000_000) throw new Error('热词响应过大');
      json += decoder.decode(value, { stream: true });
    }
    json += decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
  }
  return parseSocialHotSearches(JSON.parse(json), feed.source);
}

async function refresh(feed: Feed): Promise<Suggestion[]> {
  const fresh = available(feed, FRESH_MS);
  if (fresh) return fresh;
  if (Date.now() < feed.retryAfter) return available(feed, MAX_AGE_MS) ?? [];

  await loadSnapshot(feed);
  const saved = available(feed, FRESH_MS);
  if (saved) return saved;

  try {
    const items = await fetchFeed(feed);
    const fetchedAt = new Date();
    feed.snapshot = { items, fetchedAt };
    feed.retryAfter = 0;
    if (process.env.POSTGRES_PRISMA_URL) {
      try {
        const data = { items: items.map(({ path }) => ({ path })), fetchedAt };
        await prisma.hotSearchSnapshot.upsert({
          where: { source: feed.source },
          create: { source: feed.source, ...data },
          update: data,
        });
      } catch { /* Keep the process-local snapshot if persistence is unavailable. */ }
    }
  } catch {
    feed.retryAfter = Date.now() + 60_000;
  }
  return available(feed, MAX_AGE_MS) ?? [];
}

function getFeed(feed: Feed): Promise<Suggestion[]> {
  if (!feed.pending) {
    feed.pending = refresh(feed).finally(() => { feed.pending = null; });
  }
  return feed.pending;
}

export async function getHotSearches(): Promise<Suggestion[]> {
  return interleaveSocialSearches(await Promise.all(feeds.map(getFeed)));
}
