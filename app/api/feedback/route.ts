import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { getVisitor, isSameOrigin, UUID } from '@/app/lib/visitor';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
async function findOwned(request: NextRequest, id: unknown) {
  if (typeof id !== 'string' || !UUID.test(id)) return null;
  const visitor = getVisitor(request);
  if (!visitor.exists) return null;
  return prisma.generatedPage.findFirst({ where: { id, visitorHash: visitor.hash }, include: { feedback: true } });
}
export async function GET(request: NextRequest) {
  try {
    const generation = await findOwned(request, request.nextUrl.searchParams.get('generationId'));
    if (!generation) return json({ message: '当前生成记录不可用，请重新生成页面' }, 404);
    return json({ value: generation.feedback?.value ?? 0 });
  } catch {
    return json({ message: '评价暂时无法读取，请重试' }, 503);
  }
}
export async function PUT(request: NextRequest) {
  if (!isSameOrigin(request)) return json({ message: '请求来源无效' }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ message: '请求格式无效' }, 400); }
  if (!body || ![-1, 0, 1].includes(body.value)) return json({ message: '评价必须为点赞、点踩或取消' }, 400);
  try {
    const generation = await findOwned(request, body.generationId);
    if (!generation) return json({ message: '当前生成记录不可用，请重新生成页面' }, 404);
    const feedback = await prisma.pageFeedback.upsert({
      where: { generationId: generation.id },
      create: { generationId: generation.id, value: body.value },
      update: { value: body.value },
    });
    return json({ value: feedback.value });
  } catch {
    return json({ message: '评价未保存，请重试' }, 503);
  }
}
