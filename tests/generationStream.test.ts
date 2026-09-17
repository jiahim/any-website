import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGenerationTransform } from '../app/lib/generationStream.ts';
async function run(payload: string, fail = false) {
  let calls = 0;
  const transform = createGenerationTransform(async () => { calls++; if (fail) throw Error('db unavailable'); return 'generation-id'; });
  const bytes = new TextEncoder().encode(payload);
  const source = new ReadableStream({ start(c) { for (let i=0;i<bytes.length;i+=7) c.enqueue(bytes.slice(i,i+7)); c.close(); } });
  const text = await new Response(source.pipeThrough(transform)).text();
  return { calls, text };
}
const event = (content: string) => `data: ${JSON.stringify({choices:[{delta:{content}}]})}\n\n`;
test('only completed HTML registers and metadata stays out of content', async () => {
  const r = await run(event('<html><body>中文</body></html>')+'data: [DONE]\n');
  assert.equal(r.calls,1); assert.match(r.text,/generation-id/);
});
test('truncated streams and error endings never register', async () => {
  for (const text of [event('<html><body>partial'),event('<html><body>page</body></html>'),event('<html><body>page</body></html>')+'data: {"choices":[{"finish_reason":"length"}]}\ndata: [DONE]\n']) assert.equal((await run(text)).calls,0);
});
test('DB failure cannot discard generated HTML', async () => {
  const r = await run(event('<html><body>page</body></html>')+'data: [DONE]\n',true);
  assert.equal(r.calls,1); assert.match(r.text,/page/); assert.match(r.text,/"id":null/);
});
