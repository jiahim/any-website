import { NextRequest, NextResponse } from 'next/server';
import { isBot } from '@/app/lib/botDetection';
import { isValidSearchPath } from '@/app/lib/pathFilter';
import { createThinkFilterTransform } from '@/app/lib/sseThinkFilter';
import {
  buildThinkingRequestOptions,
  getNoThinkPromptSuffix,
  resolveModelProvider,
  type ModelProvider,
} from '@/app/lib/modelProvider';

// 从环境变量获取配置
const apiEndpoint = process.env.SILICON_FLOW_API_ENDPOINT;
const apiKey = process.env.SILICON_FLOW_API_KEY;
const model = process.env.SILICON_FLOW_MODEL;
// 可选：显式指定模型供应商（minimax / qwen / unknown），留空时按模型名与端点自动识别
const providerOverride = process.env.MODEL_PROVIDER;
const hostUrl = `http://${process.env.NEXT_PUBLIC_HOST_URL}`;
const maxTokens = parseInt(process.env.MAX_TOKENS || '4096', 10);

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

    const { path, userAgent } = body;

    // 验证path参数
    if (!path || typeof path !== 'string') {
      return new NextResponse('缺少path参数或格式不正确', { status: 400 });
    }

    // 爬虫检测：检查请求体中的 userAgent
    if (!userAgent || isBot(userAgent)) {
      console.warn(`[bot-filter][stream] 爬虫请求被拒绝: path=${path} | UA: ${(userAgent || '').substring(0, 100)}`);
      return new NextResponse(
        JSON.stringify({ error: '请求被拒绝', message: '不支持自动化工具访问' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 路径合法性校验
    if (!isValidSearchPath(path)) {
      console.warn(`[bot-filter][stream] 非法路径被拒绝: path=${path}`);
      return new NextResponse(
        JSON.stringify({ error: '路径无效', message: '请求的路径不合法' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log("🚀 ~ stream ~ path:", path);
    console.log("🚀 ~ stream ~ userAgent:", userAgent);

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
    if (!hostUrl) {
      console.error('缺少环境变量: NEXT_PUBLIC_HOST_URL');
      return new NextResponse(
        JSON.stringify({
          error: '配置错误',
          message: '缺少主机URL配置，请检查环境变量 NEXT_PUBLIC_HOST_URL'
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
    console.log("🚀 ~ stream ~ provider:", provider);

    // 构建提示词
    const prompt = buildPromptFromPath(path, userAgent, provider);

    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        stream: true,
        max_tokens: maxTokens,
        ...buildThinkingRequestOptions(provider),
      }),
    }

    // 请求硅基流动API
    const response = await fetch(apiEndpoint, options);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('硅基流动API错误:', response.status, errorText);
      return new NextResponse(`API请求失败: ${response.status}`, { status: response.status });
    }

    if (!response.body) {
      console.error('上游API未返回流式响应体');
      return new NextResponse('上游API未返回流式响应体', { status: 502 });
    }

    // 流式转发响应，并剥离推理模型混在 content 中的 <think> 思考内容
    return new NextResponse(response.body.pipeThrough(createThinkFilterTransform()), {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('API Route错误:', error);
    return new NextResponse('服务器内部错误', { status: 500 });
  }
}

// ============================================================
// 主题池：每次请求随机选择一个主题，实现视觉多样化
// ============================================================

interface Theme {
  name: string;
  keywords: string;
  colorDirection: string;
  fontStyle: string;
  fontSuggestions: string;
  mode: 'dark' | 'light';
}

const THEME_POOL: Theme[] = [
  {
    name: '深色极简',
    keywords: '深色背景、极简主义、大量留白、高对比度、冷峻、克制',
    colorDirection: '深灰或近黑背景（如 #0f172a, #1a1a2e），纯白或浅灰文字，单一亮色点缀（电光蓝 #38bdf8 或翡翠绿 #34d399）',
    fontStyle: '科技/极客风',
    fontSuggestions: 'JetBrains Mono, Space Grotesk, IBM Plex Mono, Fira Code',
    mode: 'dark',
  },
  {
    name: '暖色编辑',
    keywords: '编辑风格、优雅、杂志感、温暖、经典排版、衬线字体',
    colorDirection: '米色或奶油色背景（如 #faf7f2, #f5f0e8），深棕或墨色文字（#2c1810, #1a1a1a），金色或酒红色点缀（#c9a96e, #8b2252）',
    fontStyle: '编辑/社论风',
    fontSuggestions: 'Playfair Display, Crimson Pro, Fraunces, Newsreader, Libre Baskerville',
    mode: 'light',
  },
  {
    name: '赛博朋克',
    keywords: '未来感、霓虹灯、科技、暗色调、发光效果、网格背景',
    colorDirection: '深色背景（#0a0a0f, #0d1117）配霓虹渐变点缀（紫 #a855f7 → 蓝 #3b82f6 → 粉 #ec4899），文字使用亮色（#e2e8f0），关键元素加 text-shadow 发光',
    fontStyle: '科技/极客风',
    fontSuggestions: 'Space Grotesk, Orbitron, Rajdhani, Share Tech Mono',
    mode: 'dark',
  },
  {
    name: '自然清新',
    keywords: '自然、清新、有机、舒适、圆润、绿色植物',
    colorDirection: '浅米或浅绿背景（#f0fdf4, #fefce8），森林绿主色（#166534, #15803d），大地色系点缀（#92400e, #a16207），柔和的圆角和阴影',
    fontStyle: '现代/创业风',
    fontSuggestions: 'DM Sans, Nunito, Quicksand, Outfit',
    mode: 'light',
  },
  {
    name: '学术典雅',
    keywords: '学术、经典、精致、衬线字体、知识感、图书馆',
    colorDirection: '象牙白或淡黄背景（#fffbeb, #fefdf2），深蓝或藏青主色（#1e3a5f, #1e293b），金色点缀（#b8860b, #d4a574），细线装饰边框',
    fontStyle: '编辑/社论风',
    fontSuggestions: 'EB Garamond, Merriweather, Lora, Source Serif 4',
    mode: 'light',
  },
  {
    name: '现代活力',
    keywords: '活力、现代、大胆、几何图形、鲜艳色彩、年轻',
    colorDirection: '纯白或极浅灰背景（#ffffff, #f8fafc），鲜艳主色（珊瑚红 #f43f5e、明黄 #eab308、电蓝 #2563eb 三选一），大块色彩区域，几何装饰元素',
    fontStyle: '现代/创业风',
    fontSuggestions: 'Plus Jakarta Sans, Sora, Clash Display, Bricolage Grotesque',
    mode: 'light',
  },
  {
    name: '复古怀旧',
    keywords: '复古、怀旧、做旧质感、暖色调、手工感、纸张纹理',
    colorDirection: '做旧纸张色背景（#f4ede4, #ede5d8），深褐色文字（#3c2415, #44403c），橙红或墨绿点缀（#c2410c, #365314），可用 subtle 纹理背景',
    fontStyle: '编辑/社论风',
    fontSuggestions: 'Bitter, Vollkorn, Spectral, Alegreya',
    mode: 'light',
  },
  {
    name: '极光梦幻',
    keywords: '梦幻、柔和渐变、玻璃态、模糊背景、轻盈、未来柔美',
    colorDirection: '浅色渐变背景（从 #e0f2fe 到 #fce7f3 或 #ede9fe），深灰文字（#334155），多彩柔和渐变点缀，玻璃态毛玻璃卡片（backdrop-blur + bg-white/60）',
    fontStyle: '现代/创业风',
    fontSuggestions: 'Inter Tight, Outfit, Satoshi, General Sans',
    mode: 'light',
  },
];

function getRandomTheme(): Theme {
  return THEME_POOL[Math.floor(Math.random() * THEME_POOL.length)];
}

// ============================================================
// 提示词构建：分层架构（基础层 → 设计层 → 结构层）
// ============================================================

// 根据路径构建提示词
function buildPromptFromPath(path: string, userAgent: string, provider: ModelProvider): string {
  const pathSegments = path.split('/').filter(segment => segment.trim() !== '');

  // 分析 User-Agent 获取设备信息
  const isMobile = /Mobile|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
  const isTablet = /iPad|Android(?=.*\bMobile\b)(?=.*\bSafari\b)/i.test(userAgent);

  const deviceType = isMobile ? '手机' : isTablet ? '平板' : '桌面设备';
  const browserInfo = userAgent.includes('Chrome') ? 'Chrome浏览器' :
    userAgent.includes('Firefox') ? 'Firefox浏览器' :
      userAgent.includes('Safari') ? 'Safari浏览器' :
        userAgent.includes('Edge') ? 'Edge浏览器' : '其他浏览器';

  if (pathSegments.length === 0) {
    return '请生成一个欢迎页面的内容';
  }

  const theme = getRandomTheme();

  const baseLayer = buildBaseLayer();
  const designLayer = buildDesignLayer(theme);
  const structureLayer = buildStructureLayer(path, deviceType, browserInfo);

  const noThinkSuffix = getNoThinkPromptSuffix(provider);

  return `${baseLayer}\n\n${designLayer}\n\n${structureLayer}${noThinkSuffix ? `\n\n${noThinkSuffix}` : ''}`;
}

// ---- 基础层：角色设定 + 反 AI Slop 美学引导 ----

function buildBaseLayer(): string {
  return `你是一位拥有十年经验的顶级前端设计师，同时也是一个 HTTP server。你的设计作品以独特的视觉风格和精致的细节闻名。

<anti_ai_slop>
你倾向于生成泛化、保守、千篇一律的"AI 模板式"设计。这是你必须克服的最大问题。请务必做出有创意的、令人眼前一亮的设计。

绝对避免以下 AI 泛化审美：
- 绝不使用 Inter、Roboto、Arial、Open Sans、Lato 等默认/系统字体
- 绝不使用白底+紫色渐变的老套 AI 配色
- 绝不使用千篇一律的三列卡片布局
- 绝不使用 bg-gray-50 或 bg-white 作为全局背景
- 绝不使用毫无特色的 "Learn More" 按钮样式
- 绝不使用平均分布、没有主次的配色方案

你必须在以下四个设计维度做出大胆、有个性的选择：

【排版 Typography】
- 必须从 Google Fonts 选择有特色的字体，通过 <link> 标签引入（加 display=swap）
- 标题字体和正文字体要形成鲜明对比（如衬线+无衬线、Display+Mono）
- 字号要有大胆跳跃：标题至少是正文字号的 3 倍以上
- 字重要有极端对比：使用极细（100-200）和极粗（700-900）的搭配，而非 400 vs 600 的微弱对比
- 最多加载 2 个字体族，以控制加载性能

【色彩与主题 Color & Theme】
- 承诺一个有凝聚力、有辨识度的配色方案
- 使用"主导色+锐利点缀色"策略，不要平均分配色彩
- 通过 Tailwind 的 arbitrary values（如 text-[#1e3a5f]、bg-[#faf7f2]）使用精确色值
- 确保文字与背景有足够的对比度（WCAG AA 标准）

【动效 Motion】
- 严禁对非交互元素（标题、段落、图片、容器等静态内容）添加任何入场动画（如 fadeIn、slideUp、staggered reveal 等）！因为页面是流式渲染的，内容会持续更新，入场动画会反复重播导致严重抖动
- 仅为交互元素添加动效：按钮和链接的悬停效果（scale、shadow、color transition，配合 transition-all duration-300）、卡片的 hover 状态变化
- 所有动效仅使用 CSS transition（不使用 @keyframes 入场动画），不使用任何 JS 库

【背景 Background】
- 绝不使用单一纯色背景！要创造氛围和视觉深度
- 使用 CSS 渐变（linear-gradient、radial-gradient）叠加出层次
- 可添加几何装饰（通过 CSS 伪元素或 SVG）、微妙的图案或光效
- 背景要与整体主题和配色方案和谐统一
</anti_ai_slop>`;
}

// ---- 设计层：具体主题 + 字体 + 配色指导 ----

function buildDesignLayer(theme: Theme): string {
  return `<design_theme>
本次页面设计主题：「${theme.name}」
风格关键词：${theme.keywords}
模式：${theme.mode === 'dark' ? '深色模式' : '浅色模式'}

配色方案：${theme.colorDirection}

推荐字体风格（${theme.fontStyle}）：${theme.fontSuggestions}
请从中选择一个作为标题字体，搭配一个对比鲜明的正文字体。通过 Google Fonts <link> 标签引入，务必加 display=swap。

请严格遵循上述主题方向进行设计，让页面的每一个视觉元素都与「${theme.name}」主题和谐统一。
</design_theme>

<streaming_friendly>
【关键约束：流式渲染友好】
页面是通过流式传输逐步呈现给用户的。因此：
- 所有样式必须优先使用 Tailwind CSS utility classes 直接写在 HTML 元素上
- 禁止在 <style> 标签中编写自定义 CSS，尽量不使用 <style> 标签
- 禁止使用 @keyframes 入场动画（流式渲染会导致动画反复重播抖动）
- <head> 部分要尽可能精简（只放 meta、title、Tailwind CDN script、Google Fonts link）
- 让有意义的 HTML 内容尽早出现在文档流中
</streaming_friendly>`;
}

// ---- 结构层：HTML 结构、链接、图片等功能性要求 ----

function decodePathSafely(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function buildSubpathLanguageGuide(path: string): {
  guide: string;
  exampleChildPath: string;
} {
  const pathSegments = decodePathSafely(path)
    .split('/')
    .map(segment => segment.trim())
    .filter(Boolean);
  const firstPathSegment = pathSegments[0] || '';
  const currentPath = `/${pathSegments.join('/')}`;
  const shouldUseChinese = /[\u3400-\u9fff\uf900-\ufaff]/.test(firstPathSegment);
  const exampleChildPath = `${currentPath}/${shouldUseChinese ? '相关主题' : 'related-topic'}`;

  if (shouldUseChinese) {
    return {
      exampleChildPath,
      guide: `- 当前一级路径「${firstPathSegment}」是中文，所有在当前路径后新追加的二级及更深层路径段必须使用中文汉字命名
- 必须保留当前完整路径前缀「${currentPath}」，正确示例：「${exampleChildPath}」
- 禁止把新追加的路径段写成英文、拼音或英文 slug`,
    };
  }

  return {
    exampleChildPath,
    guide: `- 当前一级路径「${firstPathSegment}」是英文，所有在当前路径后新追加的二级及更深层路径段必须使用英文命名
- 必须保留当前完整路径前缀「${currentPath}」，推荐使用小写英文单词和连字符，正确示例：「${exampleChildPath}」
- 禁止在新追加的路径段中使用中文`,
  };
}

function buildStructureLayer(path: string, deviceType: string, browserInfo: string): string {
  const decodedPath = decodePathSafely(path);
  const { guide: subpathLanguageGuide, exampleChildPath } = buildSubpathLanguageGuide(path);

  return `<request_context>
用户当前在使用 GET 方法，请求路径是 '${decodedPath}'
用户设备信息：${deviceType}，使用${browserInfo}
当前时间：${new Date().toLocaleString()}
</request_context>

<html_requirements>
请你对此请求和路径写出对应的 HTML 文档。

【必须包含的 head 元素】
- <meta charset="utf-8">
- <meta name="viewport" content="width=device-width, initial-scale=1.0">
- <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
- Google Fonts 的 <link> 标签（2 个字体族，带 display=swap）

【正文排版】
- 长文内容区域使用 Tailwind Typography 插件的 prose 类（如 prose prose-lg max-w-none），确保可读性
- 注意文字颜色与背景的对比度
- 内容结构清晰，使用 h1, h2, h3 标签组织层级
- 内容丰富，字数至少 1000 字

【超链接要求】
- 至少 5 个超链接
- 路径必须是本站 ${hostUrl} 当前路径的子路径绝对路径，不要使用相对路径
- 子路径语言由用户最初输入的一级路径决定，不得根据页面主题自行翻译或切换语言：
${subpathLanguageGuide}
- 链接样式需与主题配色协调，不要使用默认的蓝色链接样式，而是融入整体设计

【图片要求】
- 至少包含 1 张图片，支持使用适量图片优化阅读效果
- 使用 img 标签，添加与主题匹配的圆角和阴影类
- 注意设置好图片的尺寸
- 图片地址使用 'https://cloud-image.ullrai.com/q/{图片名称}'，图片名称是你认为应该展示的图片名称，中英文均可

【设备适配】
- 特别适配${deviceType}，确保在${deviceType}上有良好的显示效果
- 如果是移动端，增加内边距（px-4 或 px-6）防止内容贴边，控制好最大宽度

【输出格式】
- 直接输出 HTML 内容，不要在开头或结尾加上 markdown 标记
- 除了 HTML 内容外不要返回其他内容
- 不要在生成的网页内容中提及上述任何设计原则，这些原则只作为执行标准
</html_requirements>

<few_shot_example>
以下是一个高质量的页面 <head> 结构示例，展示了正确的组织方式（注意 head 部分极为精简）：

<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>页面标题</title>
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700;900&family=Source+Sans+3:wght@300;400;600&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
  <!-- 无需 <style> 标签：不使用入场动画，所有样式通过 Tailwind utility classes 定义 -->
</head>
<body class="bg-[#faf7f2] text-[#2c1810] font-['Source_Sans_3',sans-serif]">
  <!-- 内容直接开始，所有样式通过 Tailwind utility classes 在元素上定义 -->
  <header class="max-w-5xl mx-auto px-6 py-12">
    <h1 class="font-['Playfair_Display',serif] text-6xl font-900 tracking-tight">
      页面标题
    </h1>
  </header>
  <a href="${exampleChildPath}" class="inline-block px-6 py-3 bg-[#2c1810] text-[#faf7f2] rounded-lg transition-all duration-300 hover:scale-105 hover:shadow-lg">
    探索更多
  </a>
  <!-- ...更多内容... -->
</body>
</html>

注意上面的示例要点：
1. 没有 <style> 标签和入场动画——非交互元素（标题、段落等）不使用任何动画
2. 所有视觉样式都在 HTML 元素的 class 属性中通过 Tailwind 类定义
3. 使用 Tailwind arbitrary values（如 bg-[#faf7f2]）实现精确配色
4. 使用 font-['Playfair_Display',serif] 语法应用 Google Fonts
5. 交互元素（链接/按钮）使用 transition-all + hover: 实现悬停效果
6. head 部分精简，有意义的内容尽早出现
</few_shot_example>`;
}
