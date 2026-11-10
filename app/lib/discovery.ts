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

const TITLE_CLAUSE = /^透过|如何|怎么|为何|为什么|到底|宣布|回应|辟谣|曝光|通报|已致|战胜|击败|夺冠|全部|上榜|全方位|口碑反转|预告发布|(?:了|吗|呢)$/u;

export function normalizeSocialKeyword(value: unknown): string | null {
  const path = normalizeSearchPath(value);
  if (!path || path.length < 2 || path.length > 12) return null;
  return /^[\p{L}\p{N}]+(?:[ :·-][\p{L}\p{N}]+)*$/u.test(path) && /\p{L}/u.test(path) ? path : null;
}

function socialKeyword(title: string): string | null {
  const text = title.normalize('NFKC').trim();
  // An explicitly named work is a better keyword than the rest of its headline.
  const works = [...text.matchAll(/《([^《》]+)》/gu)];
  if (works.length === 1) return normalizeSocialKeyword(works[0][1]);

  const topic = text.match(/^#([^#]+)#$/u)?.[1] ?? text;
  const candidate = topic.replace(/(?:口碑反转|预告发布|全方位展示)$/u, '');
  // Reject path separators before normalization can trim them off.
  if (/[\/\\]/u.test(candidate) || TITLE_CLAUSE.test(candidate)) return null;
  return normalizeSocialKeyword(candidate);
}

export function parseSocialHotSearches(payload: unknown, source: SocialSource): Suggestion[] {
  const board = payload as { status?: unknown; items?: unknown } | null;
  if ((board?.status !== 'success' && board?.status !== 'cache') || !Array.isArray(board.items)) {
    throw new Error('热榜数据无效');
  }

  const candidates: Suggestion[] = [];
  for (const item of board.items.slice(0, 50)) {
    if (typeof item?.title !== 'string' || item.title.length > 180) continue;
    const path = socialKeyword(item.title);
    if (path) candidates.push({ path, source });
  }
  if (!candidates.length) throw new Error('热榜没有可用短词');
  return selectSuggestions(candidates, 50);
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
