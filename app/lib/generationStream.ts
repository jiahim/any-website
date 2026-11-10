/** Observe filtered SSE, register only complete output, then append metadata. */
export function createGenerationTransform(onComplete: () => Promise<string | null>) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '', tail = '';
  let done = false, stopped = false, failed = false, hasBody = false;
  const inspect = (line: string) => {
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (!payload) return;
    if (payload === '[DONE]') { done = true; return; }
    try {
      const data = JSON.parse(payload);
      if (data.error) failed = true;
      const choice = data.choices?.[0];
      if (choice?.finish_reason === 'stop') stopped = true;
      else if (choice?.finish_reason) failed = true;
      if (typeof choice?.delta?.content === 'string') {
        const joined = tail + choice.delta.content;
        hasBody ||= /<body[\s>]/i.test(joined);
        tail = joined.slice(-4096);
      }
    } catch { failed = true; }
  };
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      lines.forEach(inspect);
      controller.enqueue(chunk);
    },
    async flush(controller) {
      buffer += decoder.decode();
      if (buffer) inspect(buffer);
      // 允许模型在完整 HTML 外包裹 Markdown 代码围栏。
      const completed = (done || stopped) && !failed && hasBody && /<\/html\s*>\s*(?:```\s*)?$/i.test(tail);
      let generationId: string | null = null;
      if (completed) {
        try { generationId = await onComplete(); } catch { /* persistence must not break page generation */ }
      }
      controller.enqueue(encoder.encode(`\n\ndata: ${JSON.stringify({ generation: { id: generationId, completed } })}\n\n`));
    },
  });
}
