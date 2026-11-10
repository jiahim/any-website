import { after, NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { FeedbackInputError, readFeedbackBody, validateFeedback } from '@/app/lib/siteFeedbackInput';
import { feedbackMailEnabled } from '@/app/lib/siteFeedbackMail';
import { enqueueFeedbackMail } from '@/app/lib/siteFeedbackQueue';
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
    const mailEnabled = feedbackMailEnabled();
    const { status, mailId } = await prisma.$transaction(async tx => {
      // Serialize this visitor's submissions across app instances before checking the rolling limit.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${visitor.hash}, 0))`;
      const existing = await tx.siteFeedback.findUnique({
        where: { visitorHash_submissionId: { visitorHash: visitor.hash, submissionId } },
        select: { id: true, mailStatus: true },
      });
      if (existing) return { status: 200, mailId: mailEnabled && existing.mailStatus === 'pending' ? existing.id : null };

      const now = new Date();
      const count = await tx.siteFeedback.count({
        where: { visitorHash: visitor.hash, createdAt: { gt: new Date(now.getTime() - HOUR_MS) } },
      });
      if (count >= HOURLY_LIMIT) return { status: 429, mailId: null };

      const feedback = await tx.siteFeedback.create({ select: { id: true }, data: {
        visitorHash: visitor.hash,
        submissionId,
        message,
        screenshotMimeType: screenshot?.mimeType,
        screenshotBytes: screenshot ? Uint8Array.from(screenshot.bytes) : undefined,
        createdAt: now,
        mailStatus: mailEnabled ? 'pending' : 'disabled',
        mailNextAttemptAt: mailEnabled ? now : null,
      } });
      return { status: 201, mailId: mailEnabled ? feedback.id : null };
    }, { isolationLevel: 'ReadCommitted' });

    if (status === 429) return json('提交次数过多，请稍后再试', status);
    if (mailId) {
      after(async () => {
        try {
          await enqueueFeedbackMail(mailId);
        } catch {
          console.error('[feedback-mail] Queue publish failed, feedback remains pending');
        }
      });
    }
    return json('已收到你的反馈，谢谢！', status);
  } catch (error) {
    if (error instanceof FeedbackInputError) return json(error.message, error.status);
    console.error('[site-feedback] Database write failed');
    return json('反馈暂时无法保存，请稍后重试', 503);
  }
}
