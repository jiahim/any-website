# 硅基流动API端点（可选，有默认值）
SILICON_FLOW_API_ENDPOINT=https://api.siliconflow.com/v1/chat/completions

# 硅基流动API密钥（必需）
SILICON_FLOW_API_KEY=your_api_key_here 

# 硅基流动使用的模型
SILICON_FLOW_MODEL=Qwen/Qwen3-8B

# [可选] 模型供应商，决定用哪种方式关闭思考模式：qwen / minimax / unknown
# 留空时根据模型名与端点自动识别，仅在识别不准时才需要显式指定
# MODEL_PROVIDER=minimax

# 最大token数，注意根据使用的模型进行调整
MAX_TOKENS=8192

# 部署服务的主机地址
NEXT_PUBLIC_HOST_URL=localhost:3000

# [可选] 分析URL，可选，用于分析用户行为，使用的是 http://plausible.io
# NEXT_PUBLIC_ANALYTICS_URL=