import { createHash } from 'node:crypto';
import { prisma } from './prisma';
import {
  interleaveSocialSearches, isWithinAge, normalizeSocialKeyword, parseSocialHotSearchTitles, selectSuggestions,
  SOCIAL_SOURCE_LABELS, SocialHotSearchParseError, type SocialHotTitle, type SocialSource, type Suggestion,
} from './discovery';
import { isValidSearchPath } from './pathFilter';
import { extractSocialKeywords } from './socialKeywordModel';

const SLOT_MS = 30 * 60_000;
const LEASE_MS = 2 * 60_000;
const MAX_AGE_MS = 24 * 60 * 60_000;
const SNAPSHOT_KEY = 'social-keywords:v1';
const CLAIM_KEY = 'social-keywords:claim:v1';
const TITLES_PER_PLATFORM = 10;
const DEFAULT_API_BASE = 'https://newsnow.busiyi.world';
const NEWSNOW_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36';
const PLATFORMS = [
  { source: 'weibo', id: 'weibo' },
  { source: 'bilibili', id: 'bilibili-hot-search' },
  { source: 'douyin', id: 'douyin' },
] as const;

type Feed = (typeof PLATFORMS)[number];
interface PublishedKeywords { fingerprint: string; keywords: Suggestion[] }

interface FeedAttempt {
  phase: 'configure_url' | 'request' | 'http_response' | 'read_body' | 'parse_json' | 'parse_board';
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

function isSocialSource(value: unknown): value is SocialSource {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SOCIAL_SOURCE_LABELS, value);
}

function readPublished(value: unknown): PublishedKeywords | null {
  if (!value || typeof value !== 'object' || !('fingerprint' in value) || typeof value.fingerprint !== 'string'
      || !('keywords' in value) || !Array.isArray(value.keywords)) return null;

  const keywords = value.keywords.flatMap(item => {
    const path = normalizeSocialKeyword(item?.path);
    return path && isSocialSource(item?.source) ? [{ path, source: item.source }] : [];
  });
  return keywords.length ? { fingerprint: value.fingerprint, keywords } : null;
}

async function fetchFeed(feed: Feed, attempt: FeedAttempt): Promise<SocialHotTitle[]> {
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
  return parseSocialHotSearchTitles(payload).slice(0, TITLES_PER_PLATFORM).map(title => ({ title, source: feed.source }));
}

async function getFeedTitles(feed: Feed) {
  const attempt: FeedAttempt = { phase: 'configure_url' };
  const startedAt = Date.now();
  try {
    return await fetchFeed(feed, attempt);
  } catch (error) {
    logFeedFailure(feed, attempt, error, Date.now() - startedAt);
    throw new Error('NewsNow feed failed');
  }
}

async function claimSlot(slot: string, now: number) {
  const lease = JSON.stringify({ leaseUntil: now + LEASE_MS });
  // The slot remains recorded after release, so repeat deliveries cannot spend a second model call.
  return prisma.$executeRaw`
    INSERT INTO "hot_search_snapshots" ("source", "items", "fetchedAt")
    VALUES (${CLAIM_KEY}, ${lease}::jsonb, ${slot}::timestamptz AT TIME ZONE 'UTC')
    ON CONFLICT ("source") DO UPDATE SET "items" = EXCLUDED."items", "fetchedAt" = EXCLUDED."fetchedAt"
    WHERE "hot_search_snapshots"."fetchedAt" < EXCLUDED."fetchedAt"
      AND COALESCE(("hot_search_snapshots"."items"->>'leaseUntil')::bigint, 0) <= ${now}
  `;
}

async function publish(slot: string, data: PublishedKeywords, fetchedAt: Date) {
  // Lock the claim while publishing so an expired worker cannot overwrite a newer run.
  return prisma.$executeRaw`
    WITH claim AS (
      SELECT 1 FROM "hot_search_snapshots"
      WHERE "source" = ${CLAIM_KEY} AND "fetchedAt" = (${slot}::timestamptz AT TIME ZONE 'UTC') FOR UPDATE
    )
    INSERT INTO "hot_search_snapshots" ("source", "items", "fetchedAt")
    SELECT ${SNAPSHOT_KEY}, ${JSON.stringify(data)}::jsonb, ${fetchedAt.toISOString()}::timestamptz AT TIME ZONE 'UTC' FROM claim
    ON CONFLICT ("source") DO UPDATE SET "items" = EXCLUDED."items", "fetchedAt" = EXCLUDED."fetchedAt"
  `;
}

export async function refreshSocialKeywords(scheduledAt: Date) {
  const now = Date.now();
  if (!isWithinAge(scheduledAt, SLOT_MS, now)) return 'late';
  // The snapshot column is a timestamp without time zone and stores UTC.
  const slot = new Date(Math.floor(scheduledAt.getTime() / SLOT_MS) * SLOT_MS).toISOString();
  if (!await claimSlot(slot, now)) return 'already_claimed';

  try {
    const titles = (await Promise.all(PLATFORMS.map(getFeedTitles))).flat();
    const fetchedAt = new Date();
    const fingerprint = createHash('sha256').update(JSON.stringify(titles)).digest('hex');
    const saved = await prisma.hotSearchSnapshot.findUnique({ where: { source: SNAPSHOT_KEY } });
    const previous = readPublished(saved?.items);
    if (previous?.fingerprint === fingerprint) {
      return await publish(slot, previous, fetchedAt) ? 'unchanged' : 'claim_lost';
    }

    const candidates = (await extractSocialKeywords(titles)).filter(item => isValidSearchPath(item.path));
    const feeds = PLATFORMS.map(({ source }) => selectSuggestions(candidates.filter(item => item.source === source), TITLES_PER_PLATFORM));
    if (feeds.some(items => items.length === 0)) throw new Error('A social feed has no valid keywords');
    const keywords = selectSuggestions(interleaveSocialSearches(feeds), TITLES_PER_PLATFORM * PLATFORMS.length);
    return await publish(slot, { fingerprint, keywords }, fetchedAt) ? 'published' : 'claim_lost';
  } finally {
    try {
      await prisma.$executeRaw`
        UPDATE "hot_search_snapshots" SET "items" = '{}'::jsonb
        WHERE "source" = ${CLAIM_KEY} AND "fetchedAt" = (${slot}::timestamptz AT TIME ZONE 'UTC')
      `;
    } catch {
      console.warn('[social-hot-search] Claim release failed; lease will expire');
    }
  }
}

export async function getHotSearches(): Promise<Suggestion[]> {
  if (!process.env.POSTGRES_PRISMA_URL) return [];
  const saved = await prisma.hotSearchSnapshot.findUnique({ where: { source: SNAPSHOT_KEY } });
  if (!saved || !isWithinAge(saved.fetchedAt, MAX_AGE_MS)) return [];
  const fetchedAt = saved.fetchedAt.toISOString();
  return readPublished(saved.items)?.keywords.map(item => ({ ...item, fetchedAt })) ?? [];
}
