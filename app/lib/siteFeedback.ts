export const MAX_FEEDBACK_LENGTH = 500;
export const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;
export const MAX_FEEDBACK_BODY_BYTES = 2.75 * 1024 * 1024;

const SCREENSHOT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const SCREENSHOT_ACCEPT = SCREENSHOT_TYPES.join(',');

export type ScreenshotMimeType = typeof SCREENSHOT_TYPES[number];

export function isScreenshotMimeType(value: unknown): value is ScreenshotMimeType {
  return SCREENSHOT_TYPES.some(type => type === value);
}

export function feedbackLength(message: string): number {
  return Array.from(message.trim()).length;
}
