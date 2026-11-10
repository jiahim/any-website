import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGenerationTransform } from '../app/lib/generationStream.ts';

async function run(payload: string, fail = false) {
  let calls = 0;
  const transform = createGenerationTransform(async () => {
    calls++;
    if (fail) throw Error('db unavailable');
    return 'generation-id';
  });
  const bytes = new TextEncoder().encode(payload);
  const source = new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 7) {
        controller.enqueue(bytes.slice(i, i + 7));
      }
      controller.close();
    },
  });
  const text = await new Response(source.pipeThrough(transform)).text();
  const metadata = text.trimEnd().split('\n').at(-1);
  assert.ok(metadata);
  assert.match(metadata, /^data: /);
  return { calls, generation: JSON.parse(metadata.slice(6)).generation, text };
}

const event = (content: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
const finish = (reason: string) =>
  `data: ${JSON.stringify({ choices: [{ finish_reason: reason }] })}\n\n`;
const done = 'data: [DONE]\n';
const completeHtml = event('<html><body>中文</body></html>');
const partialHtml = event('<html><body>中文');

test('a complete document with [DONE] still registers', async () => {
  const result = await run(completeHtml + done);
  assert.equal(result.calls, 1);
  assert.deepEqual(result.generation, { id: 'generation-id', completed: true });
});

test('stop registers complete HTML even without [DONE]', async () => {
  const html = event('```html\n<html><bo') + event('dy>中文</body></ht') + event('ml>\n```');
  const result = await run(html + finish('stop').trimEnd());
  assert.equal(result.calls, 1);
  assert.deepEqual(result.generation, { id: 'generation-id', completed: true });
  assert.doesNotMatch(result.text, /\[DONE\]/);
});

test('missing terminal signals, truncated HTML, and explicit failures stay incomplete', async () => {
  const cases = [
    partialHtml,
    completeHtml,
    partialHtml + finish('stop'),
    partialHtml + done,
    completeHtml + event('<div') + finish('stop'),
    completeHtml + finish('length') + done,
    completeHtml + 'data: {"error":{"message":"model failure"}}\n' + done,
  ];
  for (const payload of cases) {
    const result = await run(payload);
    assert.equal(result.calls, 0, payload);
    assert.deepEqual(result.generation, { id: null, completed: false }, payload);
  }
});

test('DB failure cannot discard generated HTML', async () => {
  const result = await run(completeHtml + finish('stop'), true);
  assert.equal(result.calls, 1);
  assert.deepEqual(result.generation, { id: null, completed: true });
  assert.match(result.text, /中文/);
});
