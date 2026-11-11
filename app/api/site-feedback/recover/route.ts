import { prisma } from '@/app/lib/prisma';
import { expireFeedbackMailClaims, feedbackMailEnabled, MAX_FEEDBACK_MAIL_ATTEMPTS } from '@/app/lib/siteFeedbackMail';
import { enqueueFeedbackMail } from '@/app/lib/siteFeedbackQueue';

export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response(null, { status: 401 });
  }
  if (!feedbackMailEnabled()) return Response.json({ recovered: 0 });

  await expireFeedbackMailClaims();
  const now = new Date();
  const records = await prisma.siteFeedback.findMany({
    where: {
      mailStatus: 'pending',
      mailAttempts: { lt: MAX_FEEDBACK_MAIL_ATTEMPTS },
      // Normal retries are handled by the queue. Only revisit long overdue rows.
      mailNextAttemptAt: { lte: new Date(now.getTime() - 20 * 60_000) },
    },
    select: { id: true },
    orderBy: { mailNextAttemptAt: 'asc' },
    take: 100,
  });
  const day = now.toISOString().slice(0, 10);
  const results = await Promise.allSettled(records.map(({ id }) => enqueueFeedbackMail(id, `${id}:recovery:${day}`)));
  const failed = results.filter(result => result.status === 'rejected').length;
  if (failed) console.error(`[feedback-mail] Recovery publish failed for ${failed} feedback records`);
  return Response.json({ recovered: records.length - failed, failed }, { status: failed ? 503 : 200 });
}
