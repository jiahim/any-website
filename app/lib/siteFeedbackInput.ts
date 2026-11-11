import sharp from 'sharp';
import {
  feedbackLength, isScreenshotMimeType, MAX_FEEDBACK_BODY_BYTES, MAX_FEEDBACK_LENGTH,
  MAX_SCREENSHOT_BYTES, type ScreenshotMimeType,
} from './siteFeedback.ts';
import { UUID } from './visitorIdentity.ts';

const MAX_BASE64_LENGTH = Math.ceil(MAX_SCREENSHOT_BYTES / 3) * 4;
const MAX_PIXELS = 16_000_000;
const PNG_HEADER = Buffer.from('89504e470d0a1a0a', 'hex');
const JPEG_HEADER = Buffer.from('ffd8ff', 'hex');

export class FeedbackInputError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function readFeedbackBody(request: Pick<Request, 'headers' | 'body'>): Promise<unknown> {
  const contentType = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  const encoding = request.headers.get('content-encoding');
  if (contentType !== 'application/json' || (encoding && encoding.toLowerCase() !== 'identity')) {
    throw new FeedbackInputError('请求必须使用 JSON 格式', 415);
  }
  const oversized = () => new FeedbackInputError('反馈内容过大，请换一张较小的截图', 413);
  if (Number(request.headers.get('content-length')) > MAX_FEEDBACK_BODY_BYTES) throw oversized();
  if (!request.body) throw new FeedbackInputError('请求内容为空');

  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let text = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_FEEDBACK_BODY_BYTES) throw oversized();
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch (error) {
    if (error instanceof FeedbackInputError) throw error;
    throw new FeedbackInputError('请求内容格式无效');
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function isStaticImage(bytes: Buffer, mimeType: ScreenshotMimeType): boolean {
  if (mimeType === 'image/jpeg') return bytes.subarray(0, 3).equals(JPEG_HEADER);
  if (mimeType === 'image/webp') {
    return bytes.length >= 16 && bytes.toString('ascii', 0, 4) === 'RIFF'
      && bytes.toString('ascii', 8, 12) === 'WEBP'
      && !(bytes.toString('ascii', 12, 16) === 'VP8X' && (bytes[20] & 2));
  }
  if (!bytes.subarray(0, 8).equals(PNG_HEADER)) return false;
  // libvips may expose only the first frame of APNG. Check its animation chunk explicitly.
  for (let offset = 8; offset + 12 <= bytes.length;) {
    if (bytes.toString('ascii', offset + 4, offset + 8) === 'acTL') return false;
    offset += bytes.readUInt32BE(offset) + 12;
  }
  return true;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

async function validateScreenshot(value: unknown) {
  const screenshot = object(value);
  const mimeType = screenshot?.mimeType;
  const base64 = screenshot?.base64;
  if (!isScreenshotMimeType(mimeType) || typeof base64 !== 'string' || !base64) {
    throw new FeedbackInputError('请上传一张 PNG、JPEG 或 WebP 截图');
  }
  if (base64.length > MAX_BASE64_LENGTH) throw new FeedbackInputError('截图不能超过 2 MiB', 413);

  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length > MAX_SCREENSHOT_BYTES) throw new FeedbackInputError('截图不能超过 2 MiB', 413);
  if (!bytes.length || bytes.toString('base64') !== base64) {
    throw new FeedbackInputError('截图编码无效，请重新选择文件');
  }
  if (!isStaticImage(bytes, mimeType)) throw new FeedbackInputError('截图格式不符或包含动画');

  try {
    const image = sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: 'warning' });
    const metadata = await image.metadata();
    if (`image/${metadata.format}` !== mimeType || (metadata.pages ?? 1) > 1) throw new Error('format');
    // Force a real decode within the pixel budget. Keep the original bytes for the attachment.
    await image.stats();
  } catch {
    throw new FeedbackInputError('截图无法读取，或超过 1600 万像素');
  }
  return { bytes, mimeType };
}

export async function validateFeedback(value: unknown) {
  const body = object(value);
  if (!body || typeof body.submissionId !== 'string' || !UUID.test(body.submissionId)) {
    throw new FeedbackInputError('请求格式无效，请刷新后重试');
  }
  if (typeof body.message !== 'string' || /[\0\uD800-\uDFFF]/u.test(body.message)) {
    throw new FeedbackInputError('反馈正文含有无效字符');
  }
  const length = feedbackLength(body.message);
  if (!length || length > MAX_FEEDBACK_LENGTH) {
    throw new FeedbackInputError('请填写 1 至 500 字的反馈');
  }
  const screenshot = body.screenshot === undefined ? undefined : await validateScreenshot(body.screenshot);
  return { submissionId: body.submissionId.toLowerCase(), message: body.message.trim(), screenshot };
}
