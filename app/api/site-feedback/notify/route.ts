import { handleCallback } from '@vercel/queue';
import { sendFeedbackMail } from '@/app/lib/siteFeedbackMail';
import { UUID } from '@/app/lib/visitorIdentity';

export const maxDuration = 60;

class RetryFeedbackMail extends Error {
  readonly afterSeconds: number;

  constructor(afterSeconds: number) {
    super('Feedback mail needs another delivery');
    this.afterSeconds = afterSeconds;
  }
}

const handle = handleCallback<{ feedbackId?: string }>(async message => {
  if (!message || typeof message.feedbackId !== 'string' || !UUID.test(message.feedbackId)) return;
  const delay = await sendFeedbackMail(message.feedbackId);
  if (delay) throw new RetryFeedbackMail(delay);
}, {
  retry: error => ({ afterSeconds: error instanceof RetryFeedbackMail ? error.afterSeconds : 60 }),
});

export async function POST(request: Request) {
  // Vercel exposes this route only to its queue trigger. Do not accept callbacks on other hosts.
  if (!process.env.VERCEL_DEPLOYMENT_ID) return new Response(null, { status: 404 });
  return handle(request);
}
