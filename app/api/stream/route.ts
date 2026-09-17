import { prisma } from '@/app/lib/prisma';
import { createGenerationTransform } from '@/app/lib/generationStream';
import { attachVisitor, getVisitor } from '@/app/lib/visitor';
import { normalizeSearchPath } from '@/app/lib/discovery';
import { NextRequest, NextResponse } from 'next/server';
import { isBot } from '@/app/lib/botDetection';
import { isValidSearchPath } from '@/app/lib/pathFilter';
import { createThinkFilterTransform } from '@/app/lib/sseThinkFilter';
import {
  ModelProviderConfigError,
  resolveModelProviderConfig,
  resolveModelTokenLimit,
} from '@/app/config/modelProviders';
import {
  buildThinkingRequestOptions,
  buildTokenLimitRequestOptions,
  getNoThinkPromptSuffix,
  type ModelProtocol,
} from '@/app/lib/modelProvider';

const hostUrl = `http://${process.env.NEXT_PUBLIC_HOST_URL}`;
const configuredMaxTokens = Number(process.env.MAX_TOKENS || '4096');

interface BuiltStreamPrompt {
  content: string;
  context: {
    pathSegmentCount: number;
    deviceType: string;
    browserInfo: string;
    theme: Pick<Theme, 'name' | 'mode' | 'concept'> | null;
    noThinkSuffixApplied: boolean;
  };
}

function createStreamMetricsTransform(
  logPrefix: string,
  requestStartedAt: number,
): TransformStream<Uint8Array, Uint8Array> {
  let chunkCount = 0;
  let byteCount = 0;
  let firstChunkLogged = false;

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      chunkCount += 1;
      byteCount += chunk.byteLength;

      if (!firstChunkLogged) {
        firstChunkLogged = true;
        console.info(`${logPrefix} 首个流式数据块`, {
          timeToFirstChunkMs: Date.now() - requestStartedAt,
          bytes: chunk.byteLength,
        });
      }

      controller.enqueue(chunk);
    },
    flush() {
      console.info(`${logPrefix} 流传输完成`, {
        durationMs: Date.now() - requestStartedAt,
        chunkCount,
        byteCount,
      });
    },
  });
}

export async function POST(request: NextRequest) {
  const requestStartedAt = Date.now();
  const requestId = request.headers.get('x-request-id')?.trim().slice(0, 128)
    || crypto.randomUUID();
  const logPrefix = `[stream][${requestId}]`;

  try {

    // 检查请求体是否为空
    const contentType = request.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      console.warn(`${logPrefix} 请求 Content-Type 不合法`, { contentType });
      return new NextResponse('请求必须包含JSON内容', { status: 400 });
    }

    let body;
    try {
      body = await request.json();
    } catch (parseError) {
      console.error(`${logPrefix} JSON解析错误`, parseError);
      return new NextResponse('无效的JSON格式', { status: 400 });
    }

    const { path, userAgent } = body;

    console.info(`${logPrefix} 收到请求`, {
      input: {
        path: typeof path === 'string' ? path : null,
        userAgent: typeof userAgent === 'string' ? userAgent : null,
      },
      http: {
        contentType,
        accept: request.headers.get('accept'),
      },
    });

    // 验证path参数
    if (!path || typeof path !== 'string') {
      console.warn(`${logPrefix} path 参数无效`, { pathType: typeof path });
      return new NextResponse('缺少path参数或格式不正确', { status: 400 });
    }

    // 爬虫检测：检查请求体中的 userAgent
    if (!userAgent || isBot(userAgent)) {
      console.warn(`${logPrefix} [bot-filter] 爬虫请求被拒绝`, {
        path,
        userAgent: (userAgent || '').substring(0, 100),
      });
      return new NextResponse(
        JSON.stringify({ error: '请求被拒绝', message: '不支持自动化工具访问' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 路径合法性校验
    if (!isValidSearchPath(path)) {
      console.warn(`${logPrefix} [bot-filter] 非法路径被拒绝`, { path });
      return new NextResponse(
        JSON.stringify({ error: '路径无效', message: '请求的路径不合法' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!hostUrl) {
      console.error(`${logPrefix} 缺少环境变量: NEXT_PUBLIC_HOST_URL`);
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

    const provider = resolveModelProviderConfig('paid');
    const tokenLimit = resolveModelTokenLimit(provider.model, configuredMaxTokens);

    if (tokenLimit.clamped) {
      console.warn(`${logPrefix} MAX_TOKENS 超过模型上限，已自动收敛`, {
        model: provider.model.id,
        configuredMaxOutputTokens: tokenLimit.configuredMaxOutputTokens,
        modelMaxOutputTokens: tokenLimit.modelMaxOutputTokens,
        effectiveMaxOutputTokens: tokenLimit.effectiveMaxOutputTokens,
      });
    }

    // 构建提示词
    const prompt = buildPromptFromPath(path, userAgent, provider.model.protocol);
    const tokenLimitOptions = buildTokenLimitRequestOptions(
      provider.model.tokenLimitParameter,
      tokenLimit.effectiveMaxOutputTokens,
    );
    const thinkingOptions = buildThinkingRequestOptions(provider.model.protocol);

    console.info(`${logPrefix} 上游请求上下文`, {
      provider: {
        id: provider.id,
        name: provider.name,
        baseUrl: provider.baseUrl,
      },
      model: {
        id: provider.model.id,
        protocol: provider.model.protocol,
        tokenLimitParameter: provider.model.tokenLimitParameter,
        tokenLimits: provider.model.tokenLimits,
      },
      generation: {
        stream: true,
        configuredMaxOutputTokens: tokenLimit.configuredMaxOutputTokens,
        effectiveMaxOutputTokens: tokenLimit.effectiveMaxOutputTokens,
        tokenLimitClamped: tokenLimit.clamped,
        ...tokenLimitOptions,
        thinkingOptions,
      },
      prompt: {
        length: prompt.content.length,
        ...prompt.context,
      },
    });

    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model: provider.model.id,
        messages: [
          {
            role: 'user',
            content: prompt.content
          }
        ],
        stream: true,
        ...tokenLimitOptions,
        ...thinkingOptions,
      }),
    }

    const response = await fetch(provider.baseUrl, options);

    console.info(`${logPrefix} 收到上游响应`, {
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get('content-type'),
      traceId: response.headers.get('x-siliconcloud-trace-id')
        || response.headers.get('x-request-id'),
      responseHeaderMs: Date.now() - requestStartedAt,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`${logPrefix} ${provider.name} API错误`, {
        status: response.status,
        body: errorText.slice(0, 2000),
      });
      return new NextResponse(`API请求失败: ${response.status}`, { status: response.status });
    }

    if (!response.body) {
      console.error(`${logPrefix} 上游API未返回流式响应体`);
      return new NextResponse('上游API未返回流式响应体', { status: 502 });
    }

    // 流式转发响应，并剥离推理模型混在 content 中的 <think> 思考内容
    const visitor = getVisitor(request);
    const generationId = crypto.randomUUID();
    const responseStream = response.body
      .pipeThrough(createThinkFilterTransform())
      .pipeThrough(createStreamMetricsTransform(logPrefix, requestStartedAt))
      .pipeThrough(createGenerationTransform(async () => {
        const normalizedPath = normalizeSearchPath(path);
        if (!normalizedPath) return null;
        await prisma.generatedPage.create({ data: { id: generationId, path: normalizedPath, visitorHash: visitor.hash } });
        return generationId;
      }));

    const outgoing = new NextResponse(responseStream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'Connection': 'keep-alive',
        'X-Request-Id': requestId,
      },
    });
    return visitor.exists ? outgoing : attachVisitor(outgoing, visitor.id);
  } catch (error) {
    if (error instanceof ModelProviderConfigError) {
      console.error(`${logPrefix} 模型 Provider 配置错误`, { message: error.message });
      return NextResponse.json(
        { error: '配置错误', message: error.message },
        { status: 500 },
      );
    }

    console.error(`${logPrefix} API Route错误`, {
      durationMs: Date.now() - requestStartedAt,
      error,
    });
    return new NextResponse('服务器内部错误', { status: 500 });
  }
}

// ============================================================
// 主题池：每次请求随机选择一个主题，实现视觉多样化
// ============================================================

interface Theme {
  name: string;
  concept: string;
  typography: string;
  composition: string;
  colorAndMaterial: string;
  suitableContexts: string;
  adaptation: string;
  mode: 'dark' | 'light';
}

const THEME_POOL: Theme[] = [
  {
    name: '表现型编辑',
    concept: '像一篇经过艺术指导的专题报道，让排版本身参与叙事',
    typography: '标题可使用高对比衬线、复兴字体或有性格的 Grotesk；正文保持安静可读，利用流体字号、紧凑字距和跨尺度层级',
    composition: '非对称编辑网格、跨栏标题、边注、编号和全宽媒体；保留明确阅读路径，不把内容切成等尺寸卡片',
    colorAndMaterial: '纸张或墨色基底配一个锐利编辑色，可使用细线、裁切和页码感；材质克制，避免默认米色复古模板',
    suitableContexts: '文化、人物、历史、旅行、文学、艺术与长篇知识内容',
    adaptation: '若内容偏技术或轻松，保留编辑层级与排版张力，调整字体气质和颜色，不机械套用杂志复古符号',
    mode: 'light',
  },
  {
    name: '大胆极简',
    concept: '用尽可能少的元素建立鲜明、从容而有力量的视觉秩序',
    typography: '一个具有辨识度的标题尺度配稳定正文，可使用单一字体族的不同宽度或字重；避免为了对比而强制拼接字体',
    composition: '大留白、少量大色块、明确对齐和一个主视觉锚点；规则网格可以直接可见，但不要落入居中 SaaS Hero',
    colorAndMaterial: '高品质纯色或近单色基底配一个高能点缀色，允许白色；通过比例与边界建立深度，不强制渐变和阴影',
    suitableContexts: '概念解释、产品、设计、建筑、科学、哲学与需要清晰聚焦的主题',
    adaptation: '若内容天然丰富，保留信息而减少装饰，用字号、分组和留白形成节奏，不把极简误解为空洞',
    mode: 'light',
  },
  {
    name: '触感有机',
    concept: '把数字页面处理成可触摸、有人情味的材料表面',
    typography: '温暖的人文无衬线、手工感衬线或适量手写点缀；手写字体只用于短标题或标记，正文保持清楚',
    composition: '松弛但有秩序的分区、自然比例图片、不完全对称的边缘和呼吸感；可以像手册、食谱或旅行笔记',
    colorAndMaterial: '泥土、植物、石材、织物或纸张色系，搭配自然光影、微颗粒和轻微不完美；避免所有元素都做圆润软阴影',
    suitableContexts: '自然、美食、疗愈、手工、记忆、社区、生活方式与旅行',
    adaptation: '若主题偏理性，使用材料纹理和温暖配色作为辅助，不加入与内容无关的植物或手写装饰',
    mode: 'light',
  },
  {
    name: '受控最大主义拼贴',
    concept: '用层叠、碰撞和丰富细节制造能量，但让一个清晰焦点控制混乱',
    typography: '允许夸张尺度、倾斜字、字宽变化或两种字体角色碰撞；正文区域必须回到稳定行长和节奏',
    composition: '拼贴、贴纸式标注、裁切图片、重叠标题和不规则分栏；密集区与安静区交替，避免每个区域都抢注意力',
    colorAndMaterial: '高饱和色、印刷套色、撕纸边缘、印章或涂鸦中择少量使用；最多保留一个主要材质系统',
    suitableContexts: '娱乐、音乐、潮流、青年文化、幽默、个人表达与节庆内容',
    adaptation: '若内容严肃或长篇，将拼贴限制在首屏与章节分隔，正文恢复清晰编辑排版',
    mode: 'light',
  },
  {
    name: '复古未来',
    concept: '从过去想象未来，把早期 Web、太空时代和现代精度重新组合',
    typography: '扩展体、像素或技术感字体只承担标题和数据标签，正文使用高可读字体；可用等宽数字建立档案感',
    composition: '终端面板、坐标、时间戳、扫描框和模块化信息层级，但避免所有内容都变成同款 HUD 卡片',
    colorAndMaterial: '深墨或金属基底配荧光绿、琥珀或电蓝中的一种；铬感、扫描线、微光和像素纹理择一到两项',
    suitableContexts: '科幻、科技史、游戏、音乐、城市未来、太空与想象性主题',
    adaptation: '若内容与科技无关，保留“旧未来”的排版与档案语言，减少霓虹、HUD 和赛博朋克陈词滥调',
    mode: 'dark',
  },
  {
    name: '实用粗野主义',
    concept: '让结构、信息和交互直接可见，以坦率的视觉摩擦建立个性',
    typography: '系统字体、粗体 Grotesk 或等宽字体都可以有意使用；层级靠尺度、大小写、编号和边界建立',
    composition: '硬边框、可见网格、直接导航、贴近工具或海报的结构；允许不对称，但可用性高于“反设计”姿态',
    colorAndMaterial: '纯白、黑色或单一强色大面积使用，配硬阴影和实线；不使用柔和玻璃态、梦幻渐变和全局圆角',
    suitableContexts: '工具、技术、城市、运动、行动主义、实验艺术与信息密集内容',
    adaptation: '若主题柔和，保留直接结构和清晰边界，降低冲突色与硬阴影强度，避免故意难用',
    mode: 'light',
  },
  {
    name: '电影感空间',
    concept: '用光线、尺度和图像景深建立像电影场景一样的空间叙事',
    typography: '克制的电影标题、宽松字距或高对比标题字体，正文像字幕或场刊一样稳定；避免通篇发光文字',
    composition: '全幅图像、大片负空间、前景与背景层次、横向场景切换感；正文必须拥有独立可读区域',
    colorAndMaterial: '深色或低饱和基底、一个方向明确的光源、局部光晕和细腻阴影；不依赖 WebGL 或重型 3D',
    suitableContexts: '地点、旅行、影视、人物、科幻、自然奇观与沉浸式故事',
    adaptation: '若图片题材普通，用裁切、光影和尺度建立电影感，不伪造复杂 3D，也不让暗色牺牲对比度',
    mode: 'dark',
  },
  {
    name: '在地文化档案',
    concept: '像一份由当地人整理的鲜活档案，让语言、材料和日常细节成为身份',
    typography: '优先目标语言字形完整性，从本地出版物、路牌或文献提取排版气质，但不复制刻板书法符号',
    composition: '档案编号、时间线、地图式索引、口述引文和纪实图片共同叙事；层级清楚，避免博物馆模板化',
    colorAndMaterial: '从地域环境、建筑、食物或工艺中提取有限色板和真实材质，避免国旗色与传统纹样的生硬拼贴',
    suitableContexts: '地域、历史、社区、饮食、手工艺、民俗、人物与语言文化',
    adaptation: '缺少可靠地域线索时保持纪实和档案感，不杜撰象征、不使用文化刻板印象',
    mode: 'light',
  },
  {
    name: '多巴胺玩趣',
    concept: '以鲜明色彩、尺度反差和小惊喜制造直接、友善的快乐',
    typography: '圆润或夸张展示字可用于短标题，正文保持清爽；用大小、旋转或颜色变化制造节奏，而不是堆满彩字',
    composition: '大形状、趣味裁切、可探索的小彩蛋和明确交互区；保持一个主角，避免所有模块同时跳动',
    colorAndMaterial: '高饱和主色配一到两个支持色，可加入贴纸、软质或玩具般材质；确保正文对比度，不使用彩虹渐变兜底',
    suitableContexts: '儿童、动物、美食、创意、节日、轻喜剧、兴趣与想象性内容',
    adaptation: '若内容严肃，保留清晰色块和友善尺度，移除幼稚图形与过度活泼语气',
    mode: 'light',
  },
  {
    name: '超现实静谧',
    concept: '把熟悉物体放进明亮而不可能的空间，用一个克制意象制造梦境般的停顿与余味',
    typography: '细致而有张力的标题配安静正文，可用意外的字距、纵向标注或局部倾斜，不依赖持续运动',
    composition: '大幅但可见的浅色空气感空间、单一超现实图像、悬置物体和不合常理的尺度关系；用前景、中景、背景至少三个可辨层次承载内容，不把随机元素当成深度',
    colorAndMaterial: '以雾白、浅沙、灰蓝或淡薰衣草（如 #f4f1ea、#dfe8ec、#e7e1ef）作为大面积明亮基底，深墨色正文配一个钴蓝、珊瑚红或酸性绿异常色；使用可见的柔和阴影、景深或细颗粒，禁止大面积纯黑/近黑背景和玻璃卡片堆叠',
    suitableContexts: '梦境、文学、哲学、宇宙、心理、诗歌、神秘与概念性主题',
    adaptation: '若内容务实，将超现实限制为一个首屏母题，正文使用清晰、平静的编辑布局',
    mode: 'light',
  },
];

function getRandomTheme(): Theme {
  return THEME_POOL[Math.floor(Math.random() * THEME_POOL.length)];
}

// ============================================================
// 提示词构建：分层架构（基础层 → 设计层 → 结构层）
// ============================================================

// 根据路径构建提示词，并返回便于请求日志记录的非敏感上下文
function buildPromptFromPath(
  path: string,
  userAgent: string,
  protocol: ModelProtocol,
): BuiltStreamPrompt {
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
    return {
      content: '请生成一个欢迎页面的内容',
      context: {
        pathSegmentCount: 0,
        deviceType,
        browserInfo,
        theme: null,
        noThinkSuffixApplied: false,
      },
    };
  }

  const theme = getRandomTheme();

  const baseLayer = buildBaseLayer();
  const designLayer = buildDesignLayer(theme);
  const structureLayer = buildStructureLayer(path, deviceType, browserInfo);

  const noThinkSuffix = getNoThinkPromptSuffix(protocol);

  return {
    content: `${baseLayer}\n\n${designLayer}\n\n${structureLayer}${noThinkSuffix ? `\n\n${noThinkSuffix}` : ''}`,
    context: {
      pathSegmentCount: pathSegments.length,
      deviceType,
      browserInfo,
      theme: {
        name: theme.name,
        mode: theme.mode,
        concept: theme.concept,
      },
      noThinkSuffixApplied: noThinkSuffix !== '',
    },
  };
}

// ---- 基础层：语境优先的创意决策 + 反 AI Slop 美学引导 ----

function buildBaseLayer(): string {
  return `你是一位拥有十年经验的顶级前端设计师，同时也是一个 HTTP server。你擅长把内容语境转化为鲜明但克制的视觉系统。直接完成设计并输出最终 HTML，不要输出分析过程。

<creative_direction>
在写 HTML 前，请在内部完成以下决策，但不要把决策过程或设计原则写进页面：
1. 理解请求路径代表的主题、目标语言、内容气质、阅读场景和当前设备。
2. 用一句内部设计命题概括页面，例如“像一份来自未来城市的现场档案”。
3. 选择一个主视觉语言、一个能贯穿页面的标志性视觉母题，以及最多一个辅助趋势手法。
4. 如果随机主题与内容冲突，保留其抽象特征并做语义适配；内容语境永远优先于机械套用主题。

流行趋势只是工具箱，不是必须同时出现的清单。一个清楚而贯彻到底的创意概念，胜过多个效果的堆叠。
</creative_direction>

<anti_ai_slop>
必须避免可互换、缺乏语境的“AI 模板式”设计：
- 不使用默认 SaaS 落地页套路：居中小徽章、巨大营销标题、渐变 CTA、三列功能卡和空泛宣传语
- 不把所有信息切成等尺寸圆角卡片，不机械套用 Bento 网格或重复的“图标 + 标题 + 两行文字”组件
- 不滥用胶囊标签、全局大圆角、柔和阴影、渐变文字、紫蓝光斑、玻璃态和无意义装饰 blob
- 不用 emoji 或一组同质化线性图标代替与内容相关的视觉表达
- 不同时堆叠多层渐变、噪点、发光边缘、玻璃卡片、贴纸和滚动动画
- 不生成与当前路径无关的虚假指标、客户 Logo、推荐语、价格卡或“Learn More”占位内容

这些元素不是绝对禁用：系统字体、白色或纯色背景、规则网格、Bento、圆角和渐变在确有信息或主题作用时都可以使用。判断标准是“为什么适合这个页面”，而不是“看起来是否流行”。
</anti_ai_slop>

<design_principles>
【排版 Typography】
- 根据内容语言分配字体角色，正文首先保证字形覆盖、阅读舒适和稳定回退
- 中文正文优先使用包含中文字体的系统栈，例如 "Noto Sans CJK SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif；缺少中文字形的拉丁展示字体只能用于拉丁标题、数字或短标签
- 外部字体完全可选，每页加载 0–2 个字体族；如加载必须使用 display=swap，并提供可靠的 serif、sans-serif 或 monospace 回退
- 可优先选择一个变量字体减少请求，但不要为了炫技使用过多字宽和字重
- 使用 clamp() 或 Tailwind arbitrary values 创建流体字号；标题与正文形成清晰层级，但不机械追求固定倍数或 100 对 900 的极端字重
- 长文正文保持合理行长（约 55–75 个拉丁字符宽度或适合中文阅读的窄栏）和舒适行高

【构图 Composition】
- 建立唯一主焦点和清晰阅读路径，让密集区与留白区形成节奏
- 根据内容选择规则网格、非对称编辑网格、全宽媒体、跨栏或适度重叠，不默认使用卡片墙
- 同类信息可以组件化，但必须通过尺度、位置或内容密度形成主次，不能平均分配注意力
- 实验性桌面构图在移动端必须重排为清晰的单列或有限分栏，不能依赖横向溢出制造效果

【色彩与材质 Color & Materiality】
- 选择一个主导基底、一个主要强调色和有限辅助色，通过 Tailwind arbitrary values 使用精确色值
- 纯色、大色块、渐变、图像或轻量纹理都可以成为背景；背景只需支持主题和层级，不必为了“高级感”强行复杂
- 纸张、颗粒、自然光影、铬感、扫描线、贴纸或发光效果每次只选择少量真正有意义的材质语言
- 深色模式不等于纯黑铺满：优先使用有色深色（深蓝、墨绿、深棕或炭灰），并让页面基底、内容表面和前景元素至少形成三个可辨明度层级
- 正文与背景必须达到 WCAG AA 对比度；不能为了氛围使用低对比灰字

【标志性母题 Signature Motif】
- 从路径内容提取一个可重复的视觉线索，例如坐标、批注线、票据裁切、轨道、植物脉络或档案编号
- 母题通过少量重复建立识别度，不得遮挡正文或演变成无意义装饰
- 涉及地域文化时使用具体、可信的语言与材料线索，避免国旗色、刻板纹样和伪造符号

【动效 Motion】
- 严禁为标题、段落、图片、容器等静态内容添加 fadeIn、slideUp、stagger、scroll reveal 等入场动画；流式重写会让它们反复播放并抖动
- 只为 hover、focus、active、加载、进度和状态变化提供有目的的反馈；可以使用不依赖内容插入时机的低频环境动效
- 所有动效仅使用 CSS，不依赖外部 JS 库，并通过 motion-reduce 类或 prefers-reduced-motion 提供无位移退化
</design_principles>

<modern_toolkit>
可选的当代设计方向包括：表现型编辑排版、Bold minimalism、自由叙事构图、触感有机材质、受控最大主义与拼贴、复古未来与早期 Web、Neo-brutalism/实用主义、在地文化档案、电影感空间、多巴胺玩趣和明亮超现实。
每个页面只选择其中一个作为主方向，必要时再选择一个辅助方向，不要全部使用。
</modern_toolkit>`;
}

// ---- 设计层：具体主题 + 字体 + 配色指导 ----

function buildDesignLayer(theme: Theme): string {
  return `<design_theme>
本次页面设计主题：「${theme.name}」
核心概念：${theme.concept}
模式：${theme.mode === 'dark' ? '深色模式' : '浅色模式'}

排版方向：${theme.typography}
构图方向：${theme.composition}
配色与材质：${theme.colorAndMaterial}
适合语境：${theme.suitableContexts}
冲突适配：${theme.adaptation}

这是创作种子，不是逐项落实的效果清单。请根据路径内容取舍特征，只贯彻一个主视觉概念和一个标志性母题；不要在页面正文中提及主题名称。
</design_theme>

<streaming_friendly>
【关键约束：流式渲染友好】
页面是通过流式传输逐步呈现给用户的。因此：
- 所有样式必须优先使用 Tailwind CSS utility classes 直接写在 HTML 元素上
- 尽量不使用 <style>；只有 Tailwind 无法合理表达的少量样式才可使用精简 <style>
- 禁止非交互内容的入场动画和滚动揭示；如使用功能性或低频环境动效，必须包含 reduced-motion 退化
- <head> 只放必要 meta、title、Tailwind CDN script，以及确有需要的 0–2 个外部字体链接
- 让有意义的 HTML 内容尽早出现在文档流中
- 不加载外部 JavaScript 动效、组件或图标库
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
- 外部字体链接不是必需项；确有主题需要时最多加载 2 个字体族，并带 display=swap

【正文排版】
- 长文区域使用明确的最大行宽和舒适行高（例如 max-w-[68ch]、leading-relaxed），不要依赖未加载的 Tailwind Typography 插件
- 使用流体字号、清晰的段落间距和可扫描的章节结构
- 文字颜色与背景至少达到 WCAG AA 对比度
- 内容结构清晰，使用 h1, h2, h3 标签组织层级
- 内容丰富，字数至少 1000 字

【超链接要求】
- 至少 5 个超链接
- 路径必须是本站 ${hostUrl} 当前路径的子路径绝对路径，不要使用相对路径
- 子路径语言由用户最初输入的一级路径决定，不得根据页面主题自行翻译或切换语言：
${subpathLanguageGuide}
- 链接样式需与主题配色协调，不要使用默认的蓝色链接样式，而是融入整体设计
- 所有链接和按钮必须有清晰的 hover 与 focus-visible 状态，主要触控目标最小高度约 44px

【图片要求】
- 至少包含 1 张图片，支持使用适量图片优化阅读效果
- 使用 img 标签并提供有意义的 alt，设置明确尺寸或宽高比，防止布局跳动
- 图片的裁切、边框、圆角和阴影必须服从主题；不要默认给每张图片添加大圆角和柔和阴影
- 图片地址使用 'https://cloud-image.ullrai.com/q/{图片名称}'，图片名称是你认为应该展示的图片名称，中英文均可

【设备适配】
- 特别适配${deviceType}，确保在${deviceType}上有良好的显示效果
- 页面必须使用 overflow-x-hidden 或从布局上确保移动端无横向溢出
- 图片、超大标题、跨栏和重叠元素必须使用响应式尺寸，不能超出视口
- 如果是移动端，增加内边距（px-4 或 px-6）防止内容贴边，并将实验性多栏布局重排为清晰单列

【可访问性与动效】
- 使用语义化 HTML；交互元素保持清晰文本或 aria-label，不用无语义 div 代替按钮
- 键盘焦点必须可见，正文对比度达到 WCAG AA
- 动效不得用于静态内容入场；允许的交互动效必须使用 motion-reduce 或 prefers-reduced-motion 退化
- 不使用自动播放音频、闪烁内容或可能引发眩晕的大幅持续位移

【输出格式】
- 直接输出 HTML 内容，不要在开头或结尾加上 markdown 标记
- 除了 HTML 内容外不要返回其他内容
- 不要在生成的网页内容中提及上述任何设计原则，这些原则只作为执行标准
</html_requirements>

<few_shot_example>
以下示例只展示低偏置的文档结构、流体排版和可访问交互。不要复制它的布局作为固定模板；实际颜色、字体、构图和母题必须由本次主题与内容决定：

<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>页面标题</title>
  <!-- 仅在主题确有需要且字形覆盖合适时加入 0–2 个 display=swap 外部字体 -->
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
</head>
<body class="min-h-screen overflow-x-hidden antialiased">
  <header class="px-5 py-10 sm:px-8 sm:py-16">
    <h1 class="text-[clamp(2.75rem,10vw,7rem)] leading-[0.92] tracking-[-0.04em]">页面标题</h1>
  </header>
  <main class="px-5 pb-16 sm:px-8">
    <section aria-labelledby="section-title">
      <h2 id="section-title" class="text-[clamp(1.75rem,4vw,3.5rem)] leading-tight">章节标题</h2>
      <p class="mt-5 max-w-[68ch] text-base leading-relaxed sm:text-lg">有意义的正文内容尽早出现。</p>
      <a href="${exampleChildPath}" class="mt-7 inline-flex min-h-11 items-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 motion-reduce:transition-none">
        探索相关主题
      </a>
    </section>
  </main>
</body>
</html>

注意上面的示例要点：
1. 示例故意没有指定配色、字体或卡片结构，不能把它当成视觉模板
2. head 精简，外部字体可选，有意义的内容尽早出现
3. 使用 Tailwind arbitrary values 实现流体字号和精确主题值
4. 非交互内容没有入场动画，交互元素有键盘焦点与 reduced-motion 退化
5. 实际页面必须补全本次主题所需的颜色、字体角色、构图和视觉母题
</few_shot_example>

<quality_check>
输出前请在内部检查，不要输出检查过程：
1. 页面是否有一句清晰的创意命题、一个主视觉语言和一个标志性母题？
2. 是否避免了默认 SaaS Hero、重复圆角卡片、机械 Bento、胶囊标签泛滥和无目的渐变/玻璃态？
3. 是否最多只采用一个辅助趋势手法，而不是把所有流行效果堆在一起？
4. 外部字体是否为 0–2 个、使用 display=swap，并确保正文目标语言字形覆盖？
5. 正文对比度、focus-visible、触控尺寸和语义结构是否可用？
6. 超大标题、图片、重叠元素和多栏布局在移动端是否不会横向溢出？
7. 是否完全没有静态内容入场动画，其他动效是否提供 reduced-motion 退化？
8. 如果是深色主题，是否避免纯黑铺满，并具有至少三个可辨明度层级？
9. head 是否精简，正文是否尽早出现，是否没有加载外部 JS 库？
</quality_check>`;
}
