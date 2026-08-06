/**
 * 不同模型协议的"关闭思考"参数隔离
 *
 * 不同供应商关闭思考模式的方式完全不同，混着传会失效甚至被网关拒绝：
 * - Qwen3（硅基流动）：enable_thinking = false，另以 chat_template_kwargs 兼容其他 Qwen 网关
 * - DeepSeek / 智谱：thinking.type = 'disabled'
 * - Kimi K3：无法完全关闭思考，使用最低 reasoning_effort
 * - MiniMax：thinking.type = 'disabled'
 * - NVIDIA NIM：通过 chat_template_kwargs 关闭思考
 * 因此按模型协议分发各自的参数，标准协议不传任何厂商私有字段。
 */

export type ModelProtocol =
  | 'chat-template'
  | 'kimi'
  | 'minimax'
  | 'qwen'
  | 'standard'
  | 'thinking-toggle';

export type TokenLimitParameter = 'max_completion_tokens' | 'max_tokens';

/**
 * 供应商对应的关闭思考请求参数，展开到 chat/completions 请求体顶层
 */
export function buildThinkingRequestOptions(protocol: ModelProtocol): Record<string, unknown> {
  switch (protocol) {
    case 'minimax':
      return {
        thinking: { type: 'disabled' },
        // 兜底：M2.x 无法关闭思考，reasoning_split 为 true 时思考走 reasoning_content 字段，
        // 而不是混在 content 的 <think> 标签里，避免污染流式输出的 HTML
        reasoning_split: true,
      };
    case 'qwen':
      return {
        // 硅基流动的 OpenAI 兼容接口使用顶层 enable_thinking
        enable_thinking: false,
        // vLLM 等 Qwen 网关通常从 chat template kwargs 读取同一开关
        chat_template_kwargs: { enable_thinking: false },
      };
    case 'thinking-toggle':
      return {
        thinking: { type: 'disabled' },
      };
    case 'kimi':
      return {
        // Kimi K3 始终启用思考，只能把推理强度调到最低
        reasoning_effort: 'low',
      };
    case 'chat-template':
      return {
        chat_template_kwargs: { enable_thinking: false },
      };
    default:
      return {};
  }
}

/**
 * 新版 OpenAI 兼容接口逐步改用 max_completion_tokens；在配置中显式声明，
 * 避免向只接受其中一个字段的 Provider 同时发送两个参数。
 */
export function buildTokenLimitRequestOptions(
  parameter: TokenLimitParameter,
  value: number,
): Partial<Record<TokenLimitParameter, number>> {
  return { [parameter]: value };
}

/**
 * 供应商对应的提示词软开关后缀
 * 仅 Qwen3 识别 /no_think，其他模型加上只会污染提示词内容
 */
export function getNoThinkPromptSuffix(protocol: ModelProtocol): string {
  return protocol === 'qwen' ? '\n/no_think' : '';
}
