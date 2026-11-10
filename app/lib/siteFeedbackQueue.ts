import { send } from '@vercel/queue';

export async function enqueueFeedbackMail(feedbackId: string, idempotencyKey = feedbackId) {
  await send('site-feedback-mail', { feedbackId }, { idempotencyKey, retentionSeconds: 3600 });
}
