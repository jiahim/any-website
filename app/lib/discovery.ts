/** Pure recommendation rules; no generated or seed counts are used. */
const DAY = 86_400_000;
export const HALF_LIFE_DAYS = 30;
export function isWithinAge(fetchedAt: Date, maxAgeMs: number, now = Date.now()) {
  const age = now - fetchedAt.getTime();
  return Number.isFinite(age) && age >= 0 && age < maxAgeMs;
}
export interface Suggestion {
  path: string;
  source: 'local' | 'baidu';
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

export function parseBaiduHotSearches(html: string): Suggestion[] {
  const match = html.match(/<!--s-data:([\s\S]*?)-->/);
  if (!match) throw new Error('热榜结构已变化');
  const parsed = JSON.parse(match[1]);
  const cards: unknown = parsed?.data?.cards ?? parsed?.cards;
  if (!Array.isArray(cards)) throw new Error('热榜数据无效');
  const result: Suggestion[] = [];
  const seen = new Set<string>();
  for (const card of cards) {
    if (!Array.isArray(card?.content)) continue;
    for (const item of card.content) {
      const path = normalizeSearchPath(item?.word ?? item?.query ?? item?.title);
      if (!path || path.length > 60 || seen.has(path.toLocaleLowerCase())) continue;
      seen.add(path.toLocaleLowerCase());
      result.push({ path, source: 'baidu' });
    }
  }
  if (!result.length) throw new Error('热榜为空');
  return result.sort((a,b) => Number(/\p{Script=Han}/u.test(b.path)) - Number(/\p{Script=Han}/u.test(a.path))).slice(0,50);
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
