import { handleSchedule } from '@vercel/schedules';
import { refreshSocialKeywords } from '@/app/lib/hotSearches';

export const runtime = 'nodejs';
export const maxDuration = 75;

export const POST = handleSchedule(async ({ name, scheduledAt }) => {
  if (name !== 'social-hot-words') throw new Error('Unexpected schedule');
  try {
    const result = await refreshSocialKeywords(scheduledAt);
    process.stdout.write(`[social-hot-search] ${JSON.stringify({ phase: 'schedule_result', outcome: result, scheduledAt })}\n`);
  } catch {
    console.error('[social-hot-search]', JSON.stringify({ phase: 'schedule_result', outcome: 'failed', scheduledAt }));
    throw new Error('Social keyword refresh failed');
  }
});
