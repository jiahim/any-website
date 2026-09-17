import { prisma } from './prisma';
import { normalizeSearchPath, parseBaiduHotSearches, isWithinAge, type Suggestion } from './discovery';
const FRESH_MS = 30 * 60_000;
const MAX_AGE_MS = 24 * 60 * 60_000;
interface Snapshot { items: Suggestion[]; fetchedAt: Date }
let memory: Snapshot | null = null;
let pending: Promise<Suggestion[]> | null = null;
let retryAfter = 0;

function usable(snapshot: Snapshot | null, age: number) {
  return snapshot && isWithinAge(snapshot.fetchedAt, age);
}
function items(snapshot: Snapshot | null): Suggestion[] {
  return snapshot?.items.map(item => ({ ...item, source: 'baidu', fetchedAt: snapshot.fetchedAt.toISOString() })) ?? [];
}
async function refresh(): Promise<Suggestion[]> {
  if (usable(memory, FRESH_MS)) return items(memory);
  // Persist the last successful result so a server restart does not erase fallback data.
  if (!memory && process.env.POSTGRES_PRISMA_URL) {
    try {
      const saved = await prisma.hotSearchSnapshot.findUnique({ where: { source: 'baidu' } });
      if (saved && Array.isArray(saved.items)) {
        const safe = saved.items.flatMap(item => {
          const path = item && typeof item === 'object' && !Array.isArray(item) ? normalizeSearchPath(item.path) : null;
          return path ? [{ path, source: 'baidu' as const }] : [];
        });
        if (safe.length) memory = { items: safe, fetchedAt: saved.fetchedAt };
      }
    } catch { /* external discovery also works before the DB is configured */ }
  }
  if (usable(memory, FRESH_MS)) return items(memory);
  if (Date.now() < retryAfter) return usable(memory, MAX_AGE_MS) ? items(memory) : [];
  try {
    const response = await fetch('https://top.baidu.com/board?tab=realtime', {
      cache: 'no-store', signal: AbortSignal.timeout(6000),
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' },
    });
    if (!response.ok || !response.body) throw new Error('热词来源暂不可用');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let html = '', bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 2_000_000) throw new Error('热词响应过大');
        html += decoder.decode(value, { stream: true });
      }
      html += decoder.decode();
    } finally { await reader.cancel().catch(() => {}); }
    memory = { items: parseBaiduHotSearches(html), fetchedAt: new Date() };
    retryAfter = 0;
    if (process.env.POSTGRES_PRISMA_URL) {
      try {
        const data = { items: memory.items.map(item => ({ path: item.path, source: item.source })), fetchedAt: memory.fetchedAt };
        await prisma.hotSearchSnapshot.upsert({ where: { source: 'baidu' }, create: { source: 'baidu', ...data }, update: data });
      } catch { /* keep process-local fallback if persistence is unavailable */ }
    }
    return items(memory);
  } catch {
    retryAfter = Date.now() + 60_000;
    return usable(memory, MAX_AGE_MS) ? items(memory) : [];
  }
}
export function getHotSearches(): Promise<Suggestion[]> {
  if (pending) return pending;
  pending = refresh().finally(() => { pending = null; });
  return pending;
}
