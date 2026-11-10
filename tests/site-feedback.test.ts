import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { MAX_SCREENSHOT_BYTES, MAX_FEEDBACK_BODY_BYTES } from '../app/lib/siteFeedback.ts';
import { FeedbackInputError, readFeedbackBody, validateFeedback } from '../app/lib/siteFeedbackInput.ts';

const submissionId = '00000000-0000-4000-8000-000000000001';
const validate = (message: string, screenshot?: unknown) => validateFeedback({ submissionId, message, screenshot });
const image = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: '#c76249' } });
const screenshot = (bytes: Buffer, mimeType = 'image/png') => ({ mimeType, base64: bytes.toString('base64') });

test('feedback text uses the same trimmed Unicode limit on both sides', async () => {
  const message = '𠮷'.repeat(500);
  assert.equal((await validate(' ' + message + ' ')).message, message);
  for (const invalid of [message + '字', '  ', '无效\0字符', '\ud800']) {
    await assert.rejects(validate(invalid), { status: 400 });
  }
});

test('PNG, JPEG and WebP screenshots survive Base64 transport byte for byte', async () => {
  for (const [format, mimeType] of [['png', 'image/png'], ['jpeg', 'image/jpeg'], ['webp', 'image/webp']] as const) {
    const bytes = await image(24, 16).toFormat(format).toBuffer();
    const result = await validate('测试反馈', screenshot(bytes, mimeType));
    assert.deepEqual(result.screenshot, { bytes, mimeType });
  }
});

test('rejects spoofed, damaged, non-canonical and oversized screenshots', async () => {
  const png = await image(24, 16).png().toBuffer();
  const jpeg = await image(24, 16).jpeg().toBuffer();
  const oversized = await image(4001, 4000).png().toBuffer();
  const apng = Buffer.concat([png.subarray(0, 33), Buffer.from('000000086163544c000000020000000000000000', 'hex'), png.subarray(33)]);
  for (const invalid of [
    screenshot(jpeg), screenshot(png.subarray(0, 36)), screenshot(apng),
    { mimeType: 'image/png', base64: 'YR==' }, { mimeType: 'image/png', base64: '****' },
    { mimeType: 'image/svg+xml', base64: 'PHN2Zz4=' }, [screenshot(png)],
    screenshot(oversized),
  ]) {
    await assert.rejects(validate('测试反馈', invalid), { status: 400 });
  }
  await assert.rejects(validate('测试反馈', screenshot(Buffer.alloc(MAX_SCREENSHOT_BYTES + 1))), { status: 413 });
});

test('streams actual request bytes and rejects overflow without a truthful length header', async () => {
  for (const length of [undefined, '8']) {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(Buffer.alloc(MAX_FEEDBACK_BODY_BYTES, 32));
        controller.enqueue(Buffer.from(' '));
        controller.close();
      },
    });
    const headers = new Headers({ 'content-type': 'application/json' });
    if (length) headers.set('content-length', length);
    await assert.rejects(readFeedbackBody({ headers, body }), (error: unknown) =>
      error instanceof FeedbackInputError && error.status === 413);
  }
  await assert.rejects(readFeedbackBody(new Request('https://example.test', {
    method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}',
  })), { status: 415 });
});
