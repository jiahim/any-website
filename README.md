# 🚪 网站任意门

一个基于AI的创意内容生成平台，让探索变得有趣！

## 📖 项目简介

"网站任意门"是一个充满想象力的AI内容生成网站。用户输入任何路径，AI都会实时生成独特的网页内容。无论是魔法世界、科幻冒险，还是美食探索，AI都能为你创造惊喜！

### ✨ 核心特性

- **🎯 无限可能** - 输入任何路径，AI都会为你创建一个独特的网页内容
- **⚡ 实时生成** - 内容实时生成，就像魔法一样，你输入什么，AI就为你创造什么
- **🎮 娱乐探索** - 纯粹为了好玩！探索不同的路径，发现AI为你准备的奇妙内容
- **🎲 随机探索** - 点击随机按钮，跳出信息茧房，发现新的领域
- **💾 HTML 下载** - 页面生成完成后，可将当前结果保存为本地 HTML 文件
- **📊 热门统计** - 智能记录用户搜索，展示热门内容，支持去重防刷
- **🔍 搜索记录** - 完整的搜索历史和数据分析功能

## 🛠️ 技术栈

### 前端技术
- **Next.js 15.3.6** - React全栈框架，支持App Router
- **React 19.0.0** - 用户界面库
- **TypeScript 5** - 类型安全的JavaScript
- **Tailwind CSS 4** - 实用优先的CSS框架

### 后端技术
- **Next.js API Routes** - 服务端API接口
- **流式响应** - 支持实时内容流式传输
- **iframe** - 隔离渲染 AI 生成的完整 HTML 文档，并自动适配内容高度
- **Prisma ORM** - 类型安全的数据库操作
- **PostgreSQL** - 可靠的关系型数据库
- **Supabase** - 现代化的数据库服务

### AI集成
- **多 Provider 配置** - 内置硅基流动、DeepSeek、Kimi、智谱、MiniMax 和 NVIDIA NIM
- **智能提示词** - 避免重复内容的智能推荐

## 🚀 快速开始

### 环境要求
- Node.js 18+
- pnpm (推荐) 或 npm

### 安装依赖
```bash
# 使用 pnpm (推荐)
pnpm install

# 或使用 npm
npm install
```

### 环境配置
通过 `cp .env.example .env.local` 创建 `.env.local` 文件并配置以下环境变量：

#### 🤖 AI模型配置（必需）
```env
# 页面生成使用付费模型，随机探索使用免费模型
# 付费档可选：siliconflow / deepseek / kimi / zhipu / minimax / nvidia
# 免费档可选：siliconflow / zhipu / nvidia
PAID_MODEL_PROVIDER=siliconflow
FREE_MODEL_PROVIDER=siliconflow

# 为选中的 Provider 填写对应密钥
SILICON_FLOW_API_KEY=your_api_key_here
# DEEPSEEK_API_KEY=your_api_key_here
# MOONSHOT_API_KEY=your_api_key_here
# ZHIPU_API_KEY=your_api_key_here
# MINIMAX_API_KEY=your_api_key_here
# NVIDIA_API_KEY=your_api_key_here
MAX_TOKENS=8192
```

Provider 的请求地址、付费模型和免费模型统一维护在
[`app/config/modelProviders.ts`](app/config/modelProviders.ts)。当前预置如下：

| Provider | 配置值 | 付费模型 | 免费模型 | API Key 环境变量 |
| --- | --- | --- | --- | --- |
| 硅基流动 | `siliconflow` | `deepseek-ai/DeepSeek-V4-Flash` | `Qwen/Qwen3-8B` | `SILICON_FLOW_API_KEY` |
| DeepSeek | `deepseek` | `deepseek-v4-pro` | — | `DEEPSEEK_API_KEY` |
| Kimi | `kimi` | `kimi-k3` | — | `MOONSHOT_API_KEY` |
| 智谱 AI | `zhipu` | `glm-5.2` | `glm-4.7-flash` | `ZHIPU_API_KEY` |
| MiniMax | `minimax` | `MiniMax-M2.7` | — | `MINIMAX_API_KEY` |
| NVIDIA NIM | `nvidia` | `nvidia/nemotron-3-ultra-550b-a55b` | `nvidia/nemotron-3-nano-30b-a3b` | `NVIDIA_API_KEY` |

其中 `FREE_MODEL_PROVIDER` 只接受配置了免费模型的 Provider。试用额度和限时活动不视为长期免费模型。
`MAX_TOKENS` 是业务期望的最大输出；服务端会将其与当前模型配置的官方上限比较并自动取较小值。
模型的上下文窗口、最大输出、核对来源和核对日期均记录在 Provider 注册表中。

#### 🌐 应用配置（必需）
```env
# 主机地址（部署时请填写实际域名）
NEXT_PUBLIC_HOST_URL=localhost:3000
```

#### 👤 联系入口配置（可选）
```env
# 首页“找到我”二维码的公开图片地址；留空时不显示入口
NEXT_PUBLIC_CONTACT_QR_URL=https://cdn.example.com/path/to/xiaohongshu-qr.jpg
```

#### 📊 数据库配置（可选）
如果需要热门搜索和数据统计功能，请配置Supabase数据库：
```env
# Supabase Database Configuration
POSTGRES_URL="your_postgres_url_here"
POSTGRES_PRISMA_URL="your_postgres_prisma_url_here"
POSTGRES_URL_NON_POOLING="your_postgres_url_non_pooling_here"
POSTGRES_USER="your_postgres_user_here"
POSTGRES_PASSWORD="your_postgres_password_here"
POSTGRES_DATABASE="your_postgres_database_here"
POSTGRES_HOST="your_postgres_host_here"

# Supabase
SUPABASE_URL="your_supabase_url_here"
NEXT_PUBLIC_SUPABASE_URL="your_supabase_url_here"
SUPABASE_JWT_SECRET="your_supabase_jwt_secret_here"
SUPABASE_SERVICE_ROLE_KEY="your_supabase_service_role_key_here"
NEXT_PUBLIC_SUPABASE_ANON_KEY="your_supabase_anon_key_here"
```

#### 📈 分析工具配置（可选）
```env
# 网站访问统计，使用开源项目 Plausible
NEXT_PUBLIC_ANALYTICS_URL=https://your-analytics-url/js/script.js
NEXT_PUBLIC_ANALYTICS_WEBSITE_ID=your_website_id_here
```

> 💡 **提示**：
> - 必需配置：AI模型和应用配置是运行的基本要求
> - 数据库配置：不配置也能生成和下载页面，但无法使用热门搜索、搜索记录和下载记录功能
> - 联系入口：二维码地址未配置时，首页不会显示“找到我”入口
> - 分析工具：用于网站访问统计，可选配置

### 启动开发服务器
```bash
# 使用 pnpm (推荐)
pnpm dev

# 或使用 npm
npm run dev
```

访问 [http://localhost:3000](http://localhost:3000) 查看效果。

## 🎯 使用方法

### 基本使用
1. 在搜索框中输入任意路径，如：`魔法世界/霍格沃茨`
2. 点击"跳转"按钮
3. AI将为你生成独特的页面内容

### 随机探索
1. 点击🎲按钮获取随机领域词汇
2. 系统会避免重复你之前探索过的领域
3. 查看历史记录了解你的探索轨迹

### 下载生成结果
1. 等待页面生成完成
2. 展开页面上的可拖动浮标
3. 点击“下载 HTML 文件”，将当前生成结果保存到本地

下载文件保留生成页面使用的外部资源链接，因此离线打开时部分样式、字体或图片可能不可用。

### 示例路径
- `/魔法世界/霍格沃茨` - 魔法学院探索
- `/星际旅行/银河系` - 科幻冒险
- `/美食/意大利/披萨` - 美食文化
- `/时间/古代/唐朝` - 历史穿越
- `/音乐/古典/贝多芬` - 音乐殿堂

## ✨ 一键部署

点击下方按钮，即可将此项目部署到你自己的 Vercel 账户上。部署表单按默认的硅基流动配置收集环境变量，请将 `PAID_MODEL_PROVIDER` 和 `FREE_MODEL_PROVIDER` 都填写为 `siliconflow`，并提供 `SILICON_FLOW_API_KEY`。

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/xiexin12138/any-website.git&project-name=any-website&repository-name=any-website&env=PAID_MODEL_PROVIDER,FREE_MODEL_PROVIDER,SILICON_FLOW_API_KEY,MAX_TOKENS,NEXT_PUBLIC_HOST_URL&envDescription=默认使用硅基流动，请将付费和免费Provider填写为siliconflow，并提供API密钥、最大token数以及部署域名&envLink=https://github.com/xiexin12138/any-website/blob/main/env-setup.md)

如需使用 DeepSeek、Kimi、智谱、MiniMax 或 NVIDIA NIM，请在部署完成后修改对应的 Provider 环境变量，并添加该 Provider 所需的 API Key。`FREE_MODEL_PROVIDER` 只能选择提供免费模型的 Provider。

---

## 📁 项目结构

```
any-website/
├── app/                              # Next.js App Router
│   ├── [...slug]/                    # AI 动态页面路由
│   ├── api/
│   │   ├── download/                 # HTML 下载记录 API
│   │   ├── light-me/                 # 随机词汇生成 API
│   │   ├── stream/                   # 流式页面生成 API
│   │   └── trending/                 # 热门搜索 API
│   ├── config/modelProviders.ts      # Provider、模型与 token 上限注册表
│   ├── lib/                          # 模型适配、HTML 导出、过滤与数据库工具
│   └── ui/
│       ├── components/               # iframe、加载阶段和错误组件
│       ├── hooks/                    # 流式数据与 HTML 下载 Hooks
│       ├── DraggableLoadingIndicator.tsx
│       └── StreamRenderer.tsx
├── prisma/schema.prisma              # 数据库模型
├── scripts/                          # 数据库初始化与清理脚本
├── public/                           # 静态资源
├── .env.example                     # 环境变量示例
└── package.json                     # 项目配置
```

## 🔧 开发指南

### 构建生产版本
```bash
pnpm build
```

### 启动生产服务器
```bash
pnpm start
```

### 代码检查
```bash
pnpm lint
```

### 数据库管理
```bash
# 推送数据库架构更新
pnpm db:push

# 生成Prisma客户端
pnpm db:generate

# 初始化数据库（首次运行）
pnpm db:init

# 打开数据库管理界面
pnpm db:studio

# 清理过期数据
pnpm db:cleanup
```

### 技术特点

#### 1. 动态路由系统
- 使用Next.js的`[...slug]`捕获所有路由
- 支持无限层级的路径结构
- 自动生成页面元数据

#### 2. 流式内容渲染
- 实时接收AI生成的内容
- 使用 iframe 隔离生成页面与主应用样式
- 通过 `document.write()` 渲染完整 HTML，并自动适配内容高度
- 支持HTML、CSS、JavaScript的实时注入

#### 3. 智能内容推荐
- 记录用户探索历史
- 避免重复推荐相同领域
- 使用本地存储保留随机探索历史

#### 4. 响应式设计
- 移动端优先的设计理念
- 支持各种屏幕尺寸
- 优雅的加载动画

#### 5. 数据统计系统
- 热门搜索统计和排序
- 用户搜索去重（同一用户一天内相同搜索只记录一次）
- 搜索记录和数据分析
- 生产环境记录 HTML 下载元数据，不保存生成内容全文
- 自动数据清理机制

#### 6. 生产环境优化
- 开发环境不记录搜索数据
- 只在页面成功渲染后记录统计
- 智能的用户标识和隐私保护

## 🤝 贡献指南

欢迎提交Issue和Pull Request！

### 开发流程
1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 📄 许可证

本项目采用 MIT 许可证。

## 🙏 致谢

- [Next.js](https://nextjs.org/) - 优秀的React框架
- [Tailwind CSS](https://tailwindcss.com/) - 实用的CSS框架
- [硅基流动](https://www.siliconflow.com/) 及其他已接入 Provider - AI 模型服务

## 📞 联系方式

- 项目地址：[GitHub](https://github.com/xiexin12138/any-website)
- 问题反馈：[Issues](https://github.com/xiexin12138/any-website/issues)

---

⭐ 如果这个项目对你有帮助，请给它一个星标！
