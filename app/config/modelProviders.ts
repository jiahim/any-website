import type {
  ModelProtocol,
  TokenLimitParameter,
} from '@/app/lib/modelProvider';

export type ModelTier = 'paid' | 'free';

export interface ModelTokenLimits {
  /** 输入与输出合计的模型上下文窗口 */
  contextWindow: number;
  /** 当前 Provider 接口允许或官方验证过的单次最大输出 */
  maxOutputTokens: number;
  /** 官方资料地址，便于模型升级时复核 */
  source: string;
  verifiedAt: string;
}

export interface ModelConfig {
  id: string;
  protocol: ModelProtocol;
  tokenLimitParameter: TokenLimitParameter;
  tokenLimits: ModelTokenLimits;
}

interface ModelProviderConfig {
  name: string;
  baseUrl: string;
  apiKeyEnv: string;
  paidModel: ModelConfig;
  freeModel: ModelConfig | null;
}

/**
 * 模型服务注册表。
 *
 * 接入新服务时只需在这里补充请求地址、付费/免费模型和密钥环境变量名，
 * 运行环境通过 PAID_MODEL_PROVIDER 与 FREE_MODEL_PROVIDER 选择对应配置。
 */
export const MODEL_PROVIDERS = {
  siliconflow: {
    name: '硅基流动',
    baseUrl: 'https://api.siliconflow.cn/v1/chat/completions',
    apiKeyEnv: 'SILICON_FLOW_API_KEY',
    paidModel: {
      id: 'deepseek-ai/DeepSeek-V4-Flash',
      protocol: 'standard',
      tokenLimitParameter: 'max_tokens',
      tokenLimits: {
        contextWindow: 1_000_000,
        maxOutputTokens: 384_000,
        source: 'https://api-docs.deepseek.com/quick_start/pricing',
        verifiedAt: '2026-08-06',
      },
    },
    freeModel: {
      id: 'Qwen/Qwen3-8B',
      protocol: 'qwen',
      tokenLimitParameter: 'max_tokens',
      tokenLimits: {
        contextWindow: 131_072,
        maxOutputTokens: 38_912,
        source: 'https://huggingface.co/Qwen/Qwen3-8B',
        verifiedAt: '2026-08-06',
      },
    },
  },
  deepseek: {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/chat/completions',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    paidModel: {
      id: 'deepseek-v4-pro',
      protocol: 'thinking-toggle',
      tokenLimitParameter: 'max_tokens',
      tokenLimits: {
        contextWindow: 1_000_000,
        maxOutputTokens: 384_000,
        source: 'https://api-docs.deepseek.com/quick_start/pricing',
        verifiedAt: '2026-08-06',
      },
    },
    freeModel: null,
  },
  kimi: {
    name: 'Kimi（Moonshot AI）',
    baseUrl: 'https://api.moonshot.cn/v1/chat/completions',
    apiKeyEnv: 'MOONSHOT_API_KEY',
    paidModel: {
      id: 'kimi-k3',
      protocol: 'kimi',
      tokenLimitParameter: 'max_completion_tokens',
      tokenLimits: {
        contextWindow: 1_048_576,
        maxOutputTokens: 256_000,
        source: 'https://platform.kimi.ai/docs/guide/benchmark-best-practice',
        verifiedAt: '2026-08-06',
      },
    },
    freeModel: null,
  },
  zhipu: {
    name: '智谱 AI',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    apiKeyEnv: 'ZHIPU_API_KEY',
    paidModel: {
      id: 'glm-5.2',
      protocol: 'thinking-toggle',
      tokenLimitParameter: 'max_tokens',
      tokenLimits: {
        contextWindow: 1_000_000,
        maxOutputTokens: 131_072,
        source: 'https://docs.bigmodel.cn/cn/guide/models/text/glm-5.2',
        verifiedAt: '2026-08-06',
      },
    },
    freeModel: {
      id: 'glm-4.7-flash',
      protocol: 'thinking-toggle',
      tokenLimitParameter: 'max_tokens',
      tokenLimits: {
        contextWindow: 200_000,
        maxOutputTokens: 131_072,
        source: 'https://docs.bigmodel.cn/cn/guide/models/free/glm-4.7-flash',
        verifiedAt: '2026-08-06',
      },
    },
  },
  minimax: {
    name: 'MiniMax',
    baseUrl: 'https://api.minimaxi.com/v1/chat/completions',
    apiKeyEnv: 'MINIMAX_API_KEY',
    paidModel: {
      id: 'MiniMax-M2.7',
      protocol: 'minimax',
      tokenLimitParameter: 'max_tokens',
      tokenLimits: {
        contextWindow: 204_800,
        // MiniMax API 会为输入及系统开销预留 8K，超过此值直接返回 400。
        maxOutputTokens: 196_608,
        source: 'https://platform.minimax.io/docs/guides/text-generation',
        verifiedAt: '2026-08-06',
      },
    },
    freeModel: null,
  },
  nvidia: {
    name: 'NVIDIA NIM',
    baseUrl: 'https://integrate.api.nvidia.com/v1/chat/completions',
    apiKeyEnv: 'NVIDIA_API_KEY',
    paidModel: {
      id: 'nvidia/nemotron-3-ultra-550b-a55b',
      protocol: 'chat-template',
      tokenLimitParameter: 'max_tokens',
      tokenLimits: {
        contextWindow: 1_000_000,
        maxOutputTokens: 32_768,
        source: 'https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3-ultra-550b-a55b-infer',
        verifiedAt: '2026-08-06',
      },
    },
    freeModel: {
      id: 'nvidia/nemotron-3-nano-30b-a3b',
      protocol: 'chat-template',
      tokenLimitParameter: 'max_tokens',
      tokenLimits: {
        contextWindow: 262_144,
        maxOutputTokens: 32_768,
        source: 'https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3-nano-30b-a3b-infer',
        verifiedAt: '2026-08-06',
      },
    },
  },
} as const satisfies Record<string, ModelProviderConfig>;

export type ModelProviderId = keyof typeof MODEL_PROVIDERS;

export interface ResolvedModelProvider {
  id: ModelProviderId;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: ModelConfig;
}

const PROVIDER_ENV_BY_TIER: Record<ModelTier, string> = {
  paid: 'PAID_MODEL_PROVIDER',
  free: 'FREE_MODEL_PROVIDER',
};

const TIER_LABEL: Record<ModelTier, string> = {
  paid: '付费',
  free: '免费',
};

export class ModelProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelProviderConfigError';
  }
}

export interface ResolvedModelTokenLimit {
  configuredMaxOutputTokens: number;
  modelMaxOutputTokens: number;
  effectiveMaxOutputTokens: number;
  clamped: boolean;
}

/**
 * MAX_TOKENS 是应用期望值，模型注册表中的上限是最终安全边界。
 * 这样切换 Provider 时无需同步修改部署环境，也不会把超限请求发送到上游。
 */
export function resolveModelTokenLimit(
  model: ModelConfig,
  configuredMaxOutputTokens: number,
): ResolvedModelTokenLimit {
  if (!Number.isSafeInteger(configuredMaxOutputTokens) || configuredMaxOutputTokens <= 0) {
    throw new ModelProviderConfigError(
      `MAX_TOKENS 必须是正整数，当前值为 "${configuredMaxOutputTokens}"`,
    );
  }

  const modelMaxOutputTokens = model.tokenLimits.maxOutputTokens;
  const effectiveMaxOutputTokens = Math.min(
    configuredMaxOutputTokens,
    modelMaxOutputTokens,
  );

  return {
    configuredMaxOutputTokens,
    modelMaxOutputTokens,
    effectiveMaxOutputTokens,
    clamped: effectiveMaxOutputTokens !== configuredMaxOutputTokens,
  };
}

export function resolveModelProviderConfig(
  tier: ModelTier,
  environment: NodeJS.ProcessEnv = process.env,
): ResolvedModelProvider {
  const providerEnv = PROVIDER_ENV_BY_TIER[tier];
  const providerId = environment[providerEnv]?.trim().toLowerCase();

  if (!providerId) {
    throw new ModelProviderConfigError(`缺少环境变量 ${providerEnv}`);
  }

  if (!(providerId in MODEL_PROVIDERS)) {
    throw new ModelProviderConfigError(
      `${providerEnv} 配置了未知 Provider "${providerId}"，可选值：${Object.keys(MODEL_PROVIDERS).join('、')}`,
    );
  }

  const id = providerId as ModelProviderId;
  const provider = MODEL_PROVIDERS[id];
  const model: ModelConfig | null = tier === 'paid'
    ? provider.paidModel
    : provider.freeModel;

  if (!model) {
    const availableProviders = Object.entries(MODEL_PROVIDERS)
      .filter(([, config]) => tier === 'paid' || config.freeModel !== null)
      .map(([availableId]) => availableId)
      .join('、');

    throw new ModelProviderConfigError(
      `${provider.name} 未提供可用于${TIER_LABEL[tier]}档的模型，${providerEnv} 可选值：${availableProviders}`,
    );
  }

  const apiKey = environment[provider.apiKeyEnv]?.trim();

  if (!apiKey) {
    throw new ModelProviderConfigError(
      `缺少环境变量 ${provider.apiKeyEnv}（${provider.name}${TIER_LABEL[tier]}模型）`,
    );
  }

  return {
    id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    apiKey,
    model,
  };
}
