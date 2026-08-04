import { NextRequest, NextResponse } from 'next/server';
import {
  extractChineseRandomWord,
  pickFallbackRandomWord,
  sanitizeRandomWordHistory,
} from '@/app/lib/randomWord';
import {
  buildThinkingRequestOptions,
  getNoThinkPromptSuffix,
  resolveModelProvider,
} from '@/app/lib/modelProvider';

// 从环境变量获取配置
const apiEndpoint = process.env.SILICON_FLOW_API_ENDPOINT;
const apiKey = process.env.SILICON_FLOW_API_KEY;
const model = process.env.SILICON_FLOW_FREE_MODEL;
// 可选：显式指定模型供应商（minimax / qwen / unknown），留空时按模型名与端点自动识别
const providerOverride = process.env.MODEL_PROVIDER;

export async function POST(request: NextRequest) {
  try {
    // 检查请求体是否为空
    const contentType = request.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      return new NextResponse('请求必须包含JSON内容', { status: 400 });
    }

    let body;
    try {
      body = await request.json();
    } catch (parseError) {
      console.error('JSON解析错误:', parseError);
      return new NextResponse('无效的JSON格式', { status: 400 });
    }

    const { history = [] } = body;

    // 验证历史记录格式
    if (!Array.isArray(history)) {
      return new NextResponse('历史记录格式不正确', { status: 400 });
    }

    const safeHistory = sanitizeRandomWordHistory(history);

    // 验证必要的环境变量
    if (!apiEndpoint) {
      console.error('缺少环境变量: SILICON_FLOW_API_ENDPOINT');
      return new NextResponse(
        JSON.stringify({
          error: '配置错误',
          message: '缺少API端点配置，请检查环境变量 SILICON_FLOW_API_ENDPOINT'
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
    if (!apiKey) {
      console.error('缺少环境变量: SILICON_FLOW_API_KEY');
      return new NextResponse(
        JSON.stringify({
          error: '配置错误',
          message: '缺少API密钥配置，请检查环境变量 SILICON_FLOW_API_KEY'
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
    if (!model) {
      console.error('缺少环境变量: SILICON_FLOW_MODEL');
      return new NextResponse(
        JSON.stringify({
          error: '配置错误',
          message: '缺少模型配置，请检查环境变量 SILICON_FLOW_MODEL'
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // 识别供应商，决定用哪套关闭思考的方案
    const provider = resolveModelProvider(model, {
      endpoint: apiEndpoint,
      override: providerOverride,
    });

    const systemPrompt = [
      '你是一个随机中文词汇生成器。',
      '每次只输出一个简体中文词语，长度为 1 至 8 个汉字。',
      '禁止输出英文、拼音、完整句子、标点、引号、序号、解释或思考过程。',
      '词语应来自学习、娱乐、艺术、科技、自然、社会或当代文化等不同领域。',
    ].join('');
    const historyText = safeHistory.length > 0
      ? `以下是已经探索过的词汇，请避开相同词汇及相近领域：${JSON.stringify(safeHistory)}。`
      : '目前没有已探索词汇。';

    console.log('🚀 ~ light-me ~ request:', {
      provider,
      historyCount: safeHistory.length,
    });

    let randomWord: string | null = null;

    // 首次输出不合规时纠正重试一次，最终仍有本地中文词池兜底
    for (let attempt = 0; attempt < 2 && !randomWord; attempt++) {
      const correction = attempt === 1
        ? '上一次输出不符合格式。重新选择，只能输出一个中文词语。'
        : '';
      const prompt = `${historyText}${correction}${getNoThinkPromptSuffix(provider)}`;

      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt },
          ],
          max_tokens: 32,
          temperature: 0.8,
          top_p: 0.8,
          top_k: 20,
          ...buildThinkingRequestOptions(provider),
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('硅基流动API错误:', response.status, errorText);
        return new NextResponse(`API请求失败: ${response.status}`, { status: response.status });
      }

      const responseData = await response.json();
      // 独立 reasoning_content 不读取；混入 content 的 <think> 再由过滤器兜底剥离
      const rawContent = responseData.choices?.[0]?.message?.content;
      if (typeof rawContent === 'string') {
        randomWord = extractChineseRandomWord(rawContent);
      }

      if (!randomWord) {
        console.warn('light-me 模型输出不符合单个中文词语格式，准备重试', {
          attempt: attempt + 1,
          contentLength: typeof rawContent === 'string' ? rawContent.length : 0,
        });
      }
    }

    randomWord ??= pickFallbackRandomWord(safeHistory);

    console.log("🚀 ~ light-me ~ randomWord:", randomWord);

    // 返回随机词汇
    return new NextResponse(
      JSON.stringify({
        word: randomWord
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('light-me API错误:', error);
    return new NextResponse(
      JSON.stringify({
        error: '服务器内部错误',
        message: '获取随机词汇过程中发生错误'
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}
