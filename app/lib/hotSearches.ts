import { prisma } from './prisma';
import {
  interleaveSocialSearches, isWithinAge, normalizeSocialKeyword, parseSocialHotSearches, SocialHotSearchParseError,
  type SocialSource, type Suggestion,
} from './discovery';

const FRESH_MS = 30 * 60_000;
const MAX_AGE_MS = 24 * 60 * 60_000;
const DEFAULT_API_BASE = 'https://newsnow.busiyi.world';
const NEWSNOW_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36';
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

interface FeedAttempt {
  phase: 'configure_url' | 'request' | 'http_response' | 'read_body' | 'parse_json' | 'parse_board'
    | 'read_snapshot' | 'write_snapshot';
  signal?: AbortSignal;
  httpStatus?: number;
}

function safeErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return;
  if (typeof error.code === 'string' && /^[A-Z][A-Z0-9_]{2,39}$/.test(error.code)) return error.code;
}

function logFeedFailure(feed: Feed, attempt: FeedAttempt, error: unknown, elapsedMs?: number) {
  const cause = error instanceof Error ? error.cause : undefined;
  const parseError = error instanceof SocialHotSearchParseError ? error : undefined;
  let reason: string | undefined = parseError?.reason;
  if ((attempt.phase === 'request' || attempt.phase === 'read_body') && attempt.signal?.aborted) {
    reason = 'timeout';
  }
  if (attempt.phase === 'request' && cause instanceof Error && cause.message === 'unexpected redirect') {
    reason = 'unexpected_redirect';
  }

  // Keep URLs, response bodies, and error messages out of production logs.
  console.warn('[social-hot-search]', JSON.stringify({
    source: feed.source,
    phase: attempt.phase,
    reason,
    httpStatus: attempt.httpStatus,
    errorCode: safeErrorCode(cause) ?? safeErrorCode(error),
    upstreamItems: parseError?.upstreamItems,
    elapsedMs,
  }));
}

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
  } catch (error) {
    logFeedFailure(feed, { phase: 'read_snapshot' }, error);
  }
}

async function fetchFeed(feed: Feed, attempt: FeedAttempt): Promise<Suggestion[]> {
  const url = new URL('/api/s', process.env.SOCIAL_HOT_SEARCH_API_BASE_URL?.trim() || DEFAULT_API_BASE);
  url.searchParams.set('id', feed.id);
  attempt.phase = 'request';
  attempt.signal = AbortSignal.timeout(6000);
  const response = await fetch(url, {
    cache: 'no-store',
    redirect: 'error',
    signal: attempt.signal,
    headers: { Accept: 'application/json', 'User-Agent': NEWSNOW_USER_AGENT },
  });
  attempt.phase = 'http_response';
  attempt.httpStatus = response.status;
  if (!response.ok || !response.body) throw new Error('热词来源暂不可用');

  attempt.phase = 'read_body';
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
  attempt.phase = 'parse_json';
  const payload: unknown = JSON.parse(json);
  attempt.phase = 'parse_board';
  return parseSocialHotSearches(payload, feed.source);
}

async function refresh(feed: Feed): Promise<Suggestion[]> {
  const fresh = available(feed, FRESH_MS);
  if (fresh) return fresh;
  if (Date.now() < feed.retryAfter) return available(feed, MAX_AGE_MS) ?? [];

  await loadSnapshot(feed);
  const saved = available(feed, FRESH_MS);
  if (saved) return saved;

  const attempt: FeedAttempt = { phase: 'configure_url' };
  const startedAt = Date.now();
  try {
    const items = await fetchFeed(feed, attempt);
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
      } catch (error) {
        logFeedFailure(feed, { phase: 'write_snapshot' }, error);
      }
    }
  } catch (error) {
    feed.retryAfter = Date.now() + 60_000;
    logFeedFailure(feed, attempt, error, Date.now() - startedAt);
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
