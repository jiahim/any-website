import { createThinkStripper } from './thinkFilter';

/**
 * 上游 SSE 流的思考内容过滤转换器
 *
 * 即使已按供应商关闭思考模式（见 modelProvider.ts），仍保留这层兜底：部分模型（如 MiniMax M2.x）
 * 无法关闭思考。逐行解析 OpenAI 兼容格式的 SSE，把 delta.content 里的 <think>...</think> 剥离，
 * 同时丢弃独立的 reasoning_content / reasoning_details 字段，再按原格式重新输出，客户端无需改动。
 * 无法解析的行（心跳、注释、[DONE] 等）原样透传。
 */
export function createThinkFilterTransform(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const stripper = createThinkStripper();
  let lineBuffer = '';

  const filterLine = (rawLine: string): string | null => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

    if (!line.startsWith('data:')) return rawLine;

    const payload = line.slice(5).trim();
    if (payload === '' || payload === '[DONE]') return rawLine;

    let data: {
      choices?: {
        delta?: { content?: unknown; reasoning_content?: unknown; reasoning_details?: unknown };
        finish_reason?: unknown;
      }[];
      usage?: unknown;
    };
    try {
      data = JSON.parse(payload);
    } catch {
      return rawLine;
    }

    const choices = Array.isArray(data.choices) ? data.choices : [];
    let hadContent = false;
    let hasVisibleContent = false;

    for (const choice of choices) {
      const delta = choice?.delta;
      if (!delta) continue;

      // MiniMax 的 reasoning_split / DeepSeek 等会把思考放在独立字段，一律丢弃
      if (delta.reasoning_content !== undefined) delete delta.reasoning_content;
      if (delta.reasoning_details !== undefined) delete delta.reasoning_details;

      if (typeof delta.content === 'string' && delta.content !== '') {
        hadContent = true;
        delta.content = stripper.push(delta.content);
        if (delta.content !== '') hasVisibleContent = true;
      }
    }

    // 整块内容都是思考过程时直接丢掉该事件，避免向客户端推送无意义的空 chunk
    const hasOtherSignal =
      data.usage != null || choices.some((choice) => choice?.finish_reason != null);
    if (hadContent && !hasVisibleContent && !hasOtherSignal) return null;

    return `data: ${JSON.stringify(data)}`;
  };

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      lineBuffer += decoder.decode(chunk, { stream: true });

      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() ?? '';

      let output = '';
      for (const line of lines) {
        const filtered = filterLine(line);
        if (filtered !== null) output += `${filtered}\n`;
      }
      if (output) controller.enqueue(encoder.encode(output));
    },

    flush(controller) {
      lineBuffer += decoder.decode();
      if (!lineBuffer) return;

      const filtered = filterLine(lineBuffer);
      if (filtered !== null) controller.enqueue(encoder.encode(filtered));
    },
  });
}
