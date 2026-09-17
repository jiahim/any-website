import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { prisma } from '@/app/lib/prisma';
import { isValidSearchPath } from '@/app/lib/pathFilter';
import { normalizeSearchPath, rankSearches, selectSuggestions, type Suggestion } from '@/app/lib/discovery';
import { getHotSearches } from '@/app/lib/hotSearches';
import { isSameOrigin } from '@/app/lib/visitor';

async function getLocalSearches(category?: string): Promise<{ items: Suggestion[]; blocked: string[] }> {
  if (!process.env.POSTGRES_PRISMA_URL) return { items: [], blocked: [] };
  const now = new Date();
  const [activity, denied, feedback] = await Promise.all([
    prisma.userSearchLog.groupBy({ by: ['path', 'userHash'], where: { createdAt: { lte: now } }, _max: { createdAt: true } }),
    prisma.trendingSearch.findMany({ where: { isDeleted: true }, select: { path: true } }),
    prisma.pageFeedback.findMany({ where: { value: { not: 0 }, generation: { createdAt: { lte: now } } }, include: { generation: true } }).catch(() => []),
  ]);
  let result = rankSearches(
    activity.flatMap(row => row._max.createdAt ? [{ path: row.path, userHash: row.userHash, createdAt: row._max.createdAt }] : []),
    feedback.map(row => ({ path: row.generation.path, visitorHash: row.generation.visitorHash, value: row.value, createdAt: row.generation.createdAt })),
    denied.map(row => row.path),
  ).filter(row => isValidSearchPath(row.path));
  if (category && category !== 'all') {
    const matches = await prisma.trendingSearch.findMany({ where: { category, isDeleted: false }, select: { path: true } });
    const paths = new Set(matches.map(row => normalizeSearchPath(row.path)));
    result = result.filter(row => paths.has(row.path));
  }
  return { items: result, blocked: denied.map(row => row.path) };
}
export async function GET(request: NextRequest) {
  const raw = Number(request.nextUrl.searchParams.get('limit') ?? 12);
  const limit = Number.isInteger(raw) && raw > 0 ? Math.min(raw, 20) : 12;
  const category = request.nextUrl.searchParams.get('category') || undefined;
  const source = request.nextUrl.searchParams.get('source') || 'website';
  if (source !== 'website' && source !== 'social') {
    return NextResponse.json({ success: false, message: '无效热词来源' }, { status: 400 });
  }
  try {
    const items = source === 'website'
      ? (await getLocalSearches(category)).items
      : (await getHotSearches()).filter(item => isValidSearchPath(item.path));
    const data = selectSuggestions(items, limit).map(item => ({ path: item.path, source: item.source, ...(item.fetchedAt ? { fetchedAt: item.fetchedAt } : {}) }));
    return NextResponse.json({ success: true, source, data, total: data.length, timestamp: new Date().toISOString() }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json({ success: false, source, data: [], message: '热词暂时无法加载' }, {
      status: 503, headers: { 'Cache-Control': 'no-store' },
    });
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ success: false }, { status: 403 });
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ success: false }, { status: 400 }); }
  const path = normalizeSearchPath(body?.path);
  if (!path || !isValidSearchPath(path)) return NextResponse.json({ success: false, message: '无效搜索路径' }, { status: 400 });
  const category = typeof body.category === 'string' && body.category.length <= 30 ? body.category : '用户搜索';
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || request.headers.get('x-real-ip');
  const userAgent = request.headers.get('user-agent');
  const userHash = createHash('sha256').update(`${ip || 'unknown'}-${userAgent || 'unknown'}`).digest('hex');
  const date = new Date().toISOString().slice(0,10);
  try {
    // Unique constraint + one transaction: concurrent duplicate requests never split the counters/logs.
    await prisma.$transaction(async tx => {
      await tx.userSearchLog.create({ data: { path, userHash, date } });
      await tx.searchRecord.create({ data: { path, category, ip, userAgent } });
      await tx.trendingSearch.upsert({ where: { path }, create: { path, category, count: 1 }, update: { count: { increment: 1 }, category } });
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') return NextResponse.json({ success: true, message: '今日已记录' });
    return NextResponse.json({ success: false, message: '搜索记录暂时无法保存' }, { status: 503 });
  }
}
