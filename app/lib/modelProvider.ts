/**
 * 模型供应商识别与"关闭思考"参数隔离
 *
 * 不同供应商关闭思考模式的方式完全不同，混着传会失效甚至被网关拒绝：
 * - Qwen3（硅基流动）：chat_template_kwargs.enable_thinking = false，另有 _nothink 提示词软开关
 * - MiniMax：thinking.type = 'disabled'
 * 因此按供应商分发各自的参数，未识别的供应商不传任何厂商私有字段。
 */

export type ModelProvider = 'minimax' | 'qwen' | 'unknown';

interface ResolveOptions {
  /** API 端点，模型名不含厂商标识时作为补充判据 */
  endpoint?: string;
  /** 环境变量 MODEL_PROVIDER，显式指定时优先级最高 */
  override?: string;
}

function normalizeProvider(value: string | undefined): ModelProvider | null {
  switch (value?.trim().toLowerCase()) {
    case 'minimax':
      return 'minimax';
    case 'qwen':
      return 'qwen';
    case 'unknown':
      return 'unknown';
    default:
      return null;
  }
}

export function resolveModelProvider(model: string, options: ResolveOptions = {}): ModelProvider {
  const override = normalizeProvider(options.override);
  if (override) return override;

  const haystack = `${model} ${options.endpoint ?? ''}`.toLowerCase();
  if (haystack.includes('minimax')) return 'minimax';
  if (haystack.includes('qwen')) return 'qwen';
  return 'unknown';
}

/**
 * 供应商对应的关闭思考请求参数，展开到 chat/completions 请求体顶层
 */
export function buildThinkingRequestOptions(provider: ModelProvider): Record<string, unknown> {
  switch (provider) {
    case 'minimax':
      return {
        thinking: { type: 'disabled' },
        // 兜底：M2.x 无法关闭思考，reasoning_split 为 true 时思考走 reasoning_content 字段，
        // 而不是混在 content 的 <think> 标签里，避免污染流式输出的 HTML
        reasoning_split: true,
      };
    case 'qwen':
      return { chat_template_kwargs: { enable_thinking: false } };
    default:
      return {};
  }
}

/**
 * 供应商对应的提示词软开关后缀
 * 仅 Qwen3 识别 _nothink，其他模型加上只会污染提示词内容
 */
export function getNoThinkPromptSuffix(provider: ModelProvider): string {
  return provider === 'qwen' ? '_nothink' : '';
}
