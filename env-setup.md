# 付费模型 Provider（用于页面生成）
# 可选：siliconflow / deepseek / kimi / zhipu / minimax / nvidia
PAID_MODEL_PROVIDER=siliconflow

# 免费模型 Provider（用于随机词汇）
# 可选：siliconflow / zhipu / nvidia
FREE_MODEL_PROVIDER=siliconflow

# 为选中的 Provider 填写对应 API 密钥
SILICON_FLOW_API_KEY=your_api_key_here
# DEEPSEEK_API_KEY=your_api_key_here
# MOONSHOT_API_KEY=your_api_key_here
# ZHIPU_API_KEY=your_api_key_here
# MINIMAX_API_KEY=your_api_key_here
# NVIDIA_API_KEY=your_api_key_here

# 业务期望的最大输出 token；实际请求会按所选模型的官方上限自动收敛
MAX_TOKENS=8192

# 部署服务的主机地址
NEXT_PUBLIC_HOST_URL=localhost:3000

# [可选] 分析URL，可选，用于分析用户行为，使用的是 http://plausible.io
# NEXT_PUBLIC_ANALYTICS_URL=

Provider 的请求地址、付费模型和免费模型不再通过环境变量配置，统一维护在
`app/config/modelProviders.ts`。接入新的 Provider 时，在注册表中增加配置，并在
部署环境中添加该配置声明的 API Key 环境变量即可。

当前内置配置：

| Provider | 配置值 | 付费模型 | 免费模型 | API Key 环境变量 |
| --- | --- | --- | --- | --- |
| 硅基流动 | `siliconflow` | `deepseek-ai/DeepSeek-V4-Flash` | `Qwen/Qwen3-8B` | `SILICON_FLOW_API_KEY` |
| DeepSeek | `deepseek` | `deepseek-v4-pro` | 不提供 | `DEEPSEEK_API_KEY` |
| Kimi | `kimi` | `kimi-k3` | 不提供 | `MOONSHOT_API_KEY` |
| 智谱 AI | `zhipu` | `glm-5.2` | `glm-4.7-flash` | `ZHIPU_API_KEY` |
| MiniMax | `minimax` | `MiniMax-M2.7` | 不提供 | `MINIMAX_API_KEY` |
| NVIDIA NIM | `nvidia` | `nvidia/nemotron-3-ultra-550b-a55b` | `nvidia/nemotron-3-nano-30b-a3b` | `NVIDIA_API_KEY` |

`MAX_TOKENS` 是所有 Provider 共用的业务期望值。服务端最终发送的值为
`min(MAX_TOKENS, 当前模型的 maxOutputTokens)`；模型上下文窗口、最大输出和官方核对来源
统一维护在 `app/config/modelProviders.ts`。当环境变量超过模型上限时，后台会打印自动收敛日志。

“不提供”表示该 Provider 当前没有官方长期免费 API 模型，不能用于
`FREE_MODEL_PROVIDER`。免费额度、试用券或活动可能随时调整，不作为免费模型配置。
