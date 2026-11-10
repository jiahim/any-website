import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { FeedbackInputError, readFeedbackBody, validateFeedback } from '@/app/lib/siteFeedbackInput';
import { getVisitor, isSameOrigin } from '@/app/lib/visitor';

const HOURLY_LIMIT = 5;
const HOUR_MS = 60 * 60 * 1000;

function json(message: string, status: number) {
  return NextResponse.json({ success: status < 400, message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return json('请求来源无效', 403);
  const visitor = getVisitor(request);
  if (!visitor.exists) return json('请允许本站使用 Cookie，再刷新页面后重试', 403);

  try {
    const { submissionId, message, screenshot } = await validateFeedback(await readFeedbackBody(request));
    const queued = process.env.FEEDBACK_MAIL_ENABLED === 'true';
    const status = await prisma.$transaction(async tx => {
      // Serialize this visitor's submissions across app instances before checking the rolling limit.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${visitor.hash}, 0))`;
      const existing = await tx.siteFeedback.findUnique({
        where: { visitorHash_submissionId: { visitorHash: visitor.hash, submissionId } },
        select: { id: true },
      });
      if (existing) return 200;

      const now = new Date();
      const count = await tx.siteFeedback.count({
        where: { visitorHash: visitor.hash, createdAt: { gt: new Date(now.getTime() - HOUR_MS) } },
      });
      if (count >= HOURLY_LIMIT) return 429;

      await tx.siteFeedback.create({ data: {
        visitorHash: visitor.hash,
        submissionId,
        message,
        screenshotMimeType: screenshot?.mimeType,
        screenshotBytes: screenshot ? Uint8Array.from(screenshot.bytes) : undefined,
        createdAt: now,
        mailStatus: queued ? 'pending' : 'disabled',
        mailNextAttemptAt: queued ? now : null,
      } });
      return 201;
    }, { isolationLevel: 'ReadCommitted' });

    if (status === 429) return json('提交次数过多，请稍后再试', status);
    return json('已收到你的反馈，谢谢！', status);
  } catch (error) {
    if (error instanceof FeedbackInputError) return json(error.message, error.status);
    console.error('[site-feedback] Database write failed');
    return json('反馈暂时无法保存，请稍后重试', 503);
  }
}
