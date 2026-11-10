import { handleSchedule } from '@vercel/schedules';
import { refreshSocialKeywords } from '@/app/lib/hotSearches';

export const runtime = 'nodejs';
export const maxDuration = 75;

export const POST = handleSchedule(async ({ name, scheduledAt }) => {
  if (name !== 'social-hot-words') throw new Error('Unexpected schedule');
  try {
    const result = await refreshSocialKeywords(scheduledAt);
    console.info('[social-hot-search] Scheduled refresh', result);
  } catch {
    console.error('[social-hot-search] Scheduled refresh failed; keeping the previous snapshot');
    throw new Error('Social keyword refresh failed');
  }
});
