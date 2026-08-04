import { stripThinkContent } from "./thinkFilter";

const SAFE_HISTORY_TERM = /^[\p{L}\p{N}][\p{L}\p{N}·'’.-]{0,29}$/u;
const CHINESE_TERM = /^[\p{Script=Han}·]{1,8}$/u;
const SENTENCE_MARKERS = /(?:这是|它是|是一个|是一种|指的是|意味着|可以用来|了$|吗$|呢$|吧$|啊$|呀$)/;
const NON_TERMS = new Set(["好的", "明白", "当然", "收到", "可以", "词语", "词汇", "答案"]);

const FALLBACK_WORDS = [
  "侘寂",
  "通感",
  "熵",
  "飞地",
  "海洋雪",
  "间隔年",
  "蒙太奇",
  "博弈论",
  "微气候",
  "地方志",
  "暗物质",
  "时间晶体",
  "声音景观",
  "文化休克",
  "睡眠惯性",
  "记忆宫殿",
  "潮汐锁定",
  "语言孤岛",
  "机会成本",
  "数字孪生",
  "算法偏见",
  "群体极化",
  "共情疲劳",
  "费米悖论",
  "幸存者偏差",
  "超现实主义",
] as const;

/**
 * 只保留像“词条”的历史值，丢弃旧版本误存的句子、提示词和思考过程。
 */
export function sanitizeRandomWordHistory(value: unknown, limit = 20): string[] {
  if (!Array.isArray(value)) return [];

  const result: string[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (typeof item !== "string") continue;

    const term = stripThinkContent(item)
      .trim()
      .replace(/^["'“‘]+|["'”’]+$/g, "");
    const key = term.toLocaleLowerCase();

    if (!SAFE_HISTORY_TERM.test(term) || seen.has(key)) continue;
    seen.add(key);
    result.push(term);
    if (result.length >= limit) break;
  }

  return result;
}

/**
 * 从模型返回中提取单个中文词条；英文、句子、解释和思考内容一律拒绝。
 */
export function extractChineseRandomWord(rawContent: string): string | null {
  const content = stripThinkContent(rawContent)
    .replace(/```(?:text|plaintext)?/gi, "")
    .trim();

  for (const rawLine of content.split(/\r?\n/)) {
    let candidate = rawLine
      .trim()
      .replace(/^(?:[-*•]|\d+[.)、])\s*/, "")
      .replace(/^(?:词语|词汇|答案)\s*[:：]\s*/, "")
      .replace(/^["'“‘]+|["'”’]+$/g, "")
      .trim();

    const explanationIndex = candidate.search(/[:：]/);
    if (explanationIndex > 0) candidate = candidate.slice(0, explanationIndex).trim();

    // 逗号、句号等通常意味着模型返回了句子或解释，不尝试从中猜词
    if (/[，,。.!！?？;；（(]/.test(candidate)) continue;

    if (
      CHINESE_TERM.test(candidate) &&
      !SENTENCE_MARKERS.test(candidate) &&
      !NON_TERMS.has(candidate)
    ) {
      return candidate;
    }
  }

  return null;
}

export function pickFallbackRandomWord(history: string[]): string {
  const explored = new Set(history.map((term) => term.toLocaleLowerCase()));
  const available = FALLBACK_WORDS.filter(
    (term) => !explored.has(term.toLocaleLowerCase()),
  );
  const pool = available.length > 0 ? available : FALLBACK_WORDS;
  return pool[Math.floor(Math.random() * pool.length)];
}
