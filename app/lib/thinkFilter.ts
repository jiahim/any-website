/**
 * 推理模型思考内容剥离器
 *
 * 部分模型（如 MiniMax-M3）会把思考过程混在 delta.content 里，以 <think>...</think> 包裹返回，
 * 而不是放在独立的 reasoning_content 字段。由于流式返回会把标签切碎（例如 "<thi" + "nk>"），
 * 必须用带状态的过滤器跨 chunk 匹配，不能对单个 chunk 做正则替换。
 */

const OPEN_TAG_PREFIX = '<think';
const CLOSE_TAG_PREFIX = '</think';

export interface ThinkStripper {
  /** 输入一个流式片段，返回其中可以安全输出的正文 */
  push(chunk: string): string;
  /** 流结束时调用，输出残留在缓冲区中的正文 */
  flush(): string;
  /** 当前是否处于思考段落内部 */
  isInsideThink(): boolean;
}

/**
 * 计算字符串尾部与任一标签前缀重合的最大长度
 * 例如 "...<thi" 与 "<think" 重合 4 个字符，这部分必须留在缓冲区等待后续 chunk 判定
 */
function longestPartialTagSuffix(text: string, tokens: string[]): number {
  let max = 0;
  for (const token of tokens) {
    const limit = Math.min(token.length - 1, text.length);
    for (let len = limit; len > max; len--) {
      if (text.endsWith(token.slice(0, len))) {
        max = len;
        break;
      }
    }
  }
  return max;
}

export function createThinkStripper(): ThinkStripper {
  let buffer = '';
  let insideThink = false;

  const consume = (): string => {
    let output = '';

    for (;;) {
      if (!insideThink) {
        const openIdx = buffer.indexOf(OPEN_TAG_PREFIX);
        const closeIdx = buffer.indexOf(CLOSE_TAG_PREFIX);

        // 孤立的 </think>（缺少开始标签时）直接丢弃标签本身，保留正文
        if (closeIdx !== -1 && (openIdx === -1 || closeIdx < openIdx)) {
          const tagEnd = buffer.indexOf('>', closeIdx + CLOSE_TAG_PREFIX.length);
          if (tagEnd === -1) {
            output += buffer.slice(0, closeIdx);
            buffer = buffer.slice(closeIdx);
            return output;
          }
          output += buffer.slice(0, closeIdx);
          buffer = buffer.slice(tagEnd + 1);
          continue;
        }

        if (openIdx === -1) {
          const keep = longestPartialTagSuffix(buffer, [OPEN_TAG_PREFIX, CLOSE_TAG_PREFIX]);
          output += buffer.slice(0, buffer.length - keep);
          buffer = buffer.slice(buffer.length - keep);
          return output;
        }

        const tagEnd = buffer.indexOf('>', openIdx + OPEN_TAG_PREFIX.length);
        if (tagEnd === -1) {
          // 标签还没收全（可能是 <think> 也可能是 <thinking>），先把前面的正文放出去
          output += buffer.slice(0, openIdx);
          buffer = buffer.slice(openIdx);
          return output;
        }

        output += buffer.slice(0, openIdx);
        buffer = buffer.slice(tagEnd + 1);
        insideThink = true;
        continue;
      }

      const closeIdx = buffer.indexOf(CLOSE_TAG_PREFIX);
      if (closeIdx === -1) {
        // 思考内容全部丢弃，仅保留可能是半个结束标签的尾巴
        const keep = Math.min(CLOSE_TAG_PREFIX.length - 1, buffer.length);
        buffer = buffer.slice(buffer.length - keep);
        return output;
      }

      const tagEnd = buffer.indexOf('>', closeIdx + CLOSE_TAG_PREFIX.length);
      if (tagEnd === -1) {
        buffer = buffer.slice(closeIdx);
        return output;
      }

      buffer = buffer.slice(tagEnd + 1);
      insideThink = false;
    }
  };

  return {
    push(chunk: string): string {
      if (!chunk) return '';
      buffer += chunk;
      return consume();
    },
    flush(): string {
      if (insideThink) {
        buffer = '';
        return '';
      }
      const rest = buffer;
      buffer = '';
      return rest;
    },
    isInsideThink(): boolean {
      return insideThink;
    },
  };
}

/**
 * 一次性剥离完整文本中的思考内容（非流式场景使用）
 */
export function stripThinkContent(text: string): string {
  const stripper = createThinkStripper();
  return stripper.push(text) + stripper.flush();
}
