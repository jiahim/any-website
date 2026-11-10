/** Pure recommendation rules; no generated or seed counts are used. */
const DAY = 86_400_000;
export const HALF_LIFE_DAYS = 30;
export function isWithinAge(fetchedAt: Date, maxAgeMs: number, now = Date.now()) {
  const age = now - fetchedAt.getTime();
  return Number.isFinite(age) && age >= 0 && age < maxAgeMs;
}
export const SOCIAL_SOURCE_LABELS = {
  weibo: '微博',
  bilibili: 'B 站',
  douyin: '抖音',
} as const;
export type SocialSource = keyof typeof SOCIAL_SOURCE_LABELS;

export interface Suggestion {
  path: string;
  source: 'local' | SocialSource;
  score?: number;
  fetchedAt?: string;
}
interface Activity { path: string; userHash: string; createdAt: Date }
interface Feedback { path: string; visitorHash: string; value: number; createdAt: Date }

export function normalizeSearchPath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 1800) return null;
  let path: string;
  try { path = decodeURIComponent(value).normalize('NFKC').trim().replace(/^\/+|\/+$/g, ''); }
  catch { return null; }
  path = path.split('/').map(s => s.trim().replace(/\s+/g, ' ')).join('/');
  if (!path || path.length > 180 || /[\u0000-\u001f\u007f\ufffd<>\\?#%]/u.test(path)) return null;
  if (/:\/\//.test(path) || !/[\p{L}\p{N}]/u.test(path)) return null;
  if (path.split('/').some(s => !s || s === '.' || s === '..' || /^(?:demo|test\d*|example|undefined|null|测试\d*|示例|占位符)$/i.test(s))) return null;
  return path;
}

export function rankSearches(logs: Activity[], feedback: Feedback[], blocked: string[], now = new Date()) {
  const denied = new Set(blocked.map(normalizeSearchPath).filter(Boolean));
  const visitors = new Map<string, Map<string, number>>();
  for (const log of logs) {
    const path = normalizeSearchPath(log.path);
    const time = log.createdAt.getTime();
    if (!path || denied.has(path) || !Number.isFinite(time) || time > now.getTime()) continue;
    const perUser = visitors.get(path) ?? new Map<string, number>();
    perUser.set(log.userHash, Math.max(perUser.get(log.userHash) ?? 0, time));
    visitors.set(path, perUser);
  }
  const ratings = new Map<string, Map<string, number[]>>();
  for (const vote of feedback) {
    const path = normalizeSearchPath(vote.path);
    if (!path || ![-1, 1].includes(vote.value) || !Number.isFinite(vote.createdAt.getTime()) || vote.createdAt > now) continue;
    const perUser = ratings.get(path) ?? new Map<string, number[]>();
    perUser.set(vote.visitorHash, [...(perUser.get(vote.visitorHash) ?? []), vote.value]);
    ratings.set(path, perUser);
  }
  return [...visitors].map(([path, users]) => {
    const heat = [...users.values()].reduce((sum, time) => sum + 2 ** (-(now.getTime() - time) / DAY / HALF_LIFE_DAYS), 0);
    let positive = 0, negative = 0;
    for (const votes of ratings.get(path)?.values() ?? []) {
      const mean = votes.reduce((a,b) => a+b, 0) / votes.length;
      positive += Math.max(0, mean);
      negative += Math.max(0, -mean);
    }
    const quality = 0.8 + 0.4 * (positive + 5) / (positive + negative + 10);
    return { path, source: 'local' as const, score: heat * quality };
  }).sort((a,b) => b.score - a.score || a.path.localeCompare(b.path, 'zh-CN'));
}

export function normalizeSocialKeyword(value: unknown): string | null {
  const path = normalizeSearchPath(value);
  if (!path || path.length < 2 || path.length > 12) return null;
  return /^[\p{L}\p{N}]+(?:[ :·-][\p{L}\p{N}]+)*$/u.test(path) && /\p{L}/u.test(path) ? path : null;
}

export class SocialHotSearchParseError extends Error {
  readonly reason: 'invalid_payload' | 'no_eligible_titles';
  readonly upstreamItems?: number;

  constructor(reason: SocialHotSearchParseError['reason'], upstreamItems?: number) {
    super(reason);
    this.reason = reason;
    this.upstreamItems = upstreamItems;
  }
}

export function parseSocialHotSearchTitles(payload: unknown): string[] {
  const board = payload as { status?: unknown; items?: unknown } | null;
  if ((board?.status !== 'success' && board?.status !== 'cache') || !Array.isArray(board.items)) {
    throw new SocialHotSearchParseError('invalid_payload');
  }

  const titles = new Set<string>();
  for (const item of board.items.slice(0, 50)) {
    if (typeof item?.title !== 'string' || item.title.length > 180) continue;
    const title = item.title.trim();
    if (title) titles.add(title);
  }
  if (!titles.size) throw new SocialHotSearchParseError('no_eligible_titles', board.items.length);
  return [...titles];
}

export interface SocialHotTitle {
  title: string;
  source: SocialSource;
}

export function selectModelSocialKeywords(titles: readonly SocialHotTitle[], output: unknown): Suggestion[] {
  if (!Array.isArray(output) || output.length !== titles.length) {
    throw new Error('Incomplete social keyword output');
  }

  const keywords = new Map<number, string | null>();
  for (const item of output) {
    const id = item?.id;
    const keyword = item?.keyword;
    if (!Number.isInteger(id) || id < 1 || id > titles.length || keywords.has(id)
        || (keyword !== null && typeof keyword !== 'string')) {
      throw new Error('Invalid social keyword output');
    }
    keywords.set(id, keyword);
  }

  return titles.flatMap(({ title, source }, index) => {
    const path = normalizeSocialKeyword(keywords.get(index + 1));
    if (!path) return [];
    const text = title.normalize('NFKC');
    const start = text.indexOf(path);
    if (start < 0 || /\d\s*:\s*\d|\d+分$/u.test(path)) return [];
    // A team followed by the first half of a score is still a score.
    if (/\d$/u.test(path) && /^\s*:\s*\d/u.test(text.slice(start + path.length))) return [];
    return [{ path, source }];
  });
}

export function interleaveSocialSearches(feeds: readonly Suggestion[][]): Suggestion[] {
  const result: Suggestion[] = [];
  const length = Math.max(0, ...feeds.map(feed => feed.length));
  for (let rank = 0; rank < length; rank++) {
    for (const feed of feeds) {
      if (feed[rank]) result.push(feed[rank]);
    }
  }
  return result;
}

export function selectSuggestions(items: Suggestion[], limit: number): Suggestion[] {
  const result: Suggestion[] = [];
  const seen = new Set<string>();
  const add = (item: Suggestion) => {
    const key = item.path.toLocaleLowerCase();
    if (result.length < limit && !seen.has(key)) { seen.add(key); result.push(item); }
  };
  items.forEach(add);
  return result;
}
