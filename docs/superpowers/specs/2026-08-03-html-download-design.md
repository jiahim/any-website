# 生成页面下载为本地 HTML 文件 — 设计文档

日期：2026-08-03

## 背景

当前模型生成的 HTML 只存在于浏览器内存里，由 `app/ui/components/IframeRenderer.tsx` 通过
`document.write()` 写进 iframe 展示，页面刷新即丢失。用户希望把生成结果保存成本地 `.html` 文件，
并且希望下载行为能回传后端做埋点，以便后续复盘数据。

## 目标

1. 生成完成后，用户可一键把当前页面下载为本地 HTML 文件。
2. 下载行为上报后端并落库，可按路径和时间维度复盘。
3. 不引入新依赖，不影响现有流式渲染链路。

## 非目标

- 不做资源离线化（Tailwind CDN 等外链保持原样，离线打开会掉样式）。
- 不存储 HTML 全文，只存元数据。
- 不提供自选保存目录（不使用 File System Access API）。

## 关键决策

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 入口位置 | 复用现有可拖动浮标 | 零新增 UI 层级，浮标本就在生成完成时展示结果摘要 |
| 内容处理 | 轻度处理：剥 markdown 围栏 + 保证 charset/title | 联网打开效果与站内一致，无需服务端参与 |
| 下载时机 | 生成中置灰，完成后亮起 | 避免下载到截断的半成品 HTML |
| 落盘方式 | 客户端 Blob + `<a download>` | 内容已在内存，无需网络往返 |
| 埋点方式 | 客户端异步 POST 到新接口，落 Postgres | 与现有 trending 埋点同构 |
| 埋点粒度 | 仅元数据（path / fileName / byteSize / userAgent / ip） | 轻量，不占库，足够复盘 |
| 埋点环境 | 仅 production | 与 `StreamRenderer.tsx:27` 现有约定一致 |

## 架构

### 文件改动清单

| 文件 | 动作 | 职责 |
| --- | --- | --- |
| `app/lib/htmlExport.ts` | 新增 | 纯函数：清洗 HTML、补 charset/title、生成安全文件名 |
| `app/ui/hooks/useHtmlDownload.ts` | 新增 | 封装 Blob 落盘 + 埋点上报 |
| `app/ui/DraggableLoadingIndicator.tsx` | 修改 | 加下载按钮，新增 `path` prop |
| `app/ui/StreamRenderer.tsx` | 修改 | 把 `path` 透传给浮标 |
| `app/ui/components/IframeRenderer.tsx` | 修改 | 改为从 `htmlExport` 引入 `cleanMarkdownCodeBlock` |
| `app/api/download/route.ts` | 新增 | 接收埋点，写 `DownloadRecord` |
| `prisma/schema.prisma` | 修改 | 新增 `DownloadRecord` 模型 |

### 顺带清理

`cleanMarkdownCodeBlock` 目前私有在 `IframeRenderer.tsx:14`。下载需要同一套清洗规则，
抽到 `app/lib/htmlExport.ts` 共享，避免两处规则漂移导致"预览正常但下载的文件多出 markdown 围栏"。

### 单元接口

**`app/lib/htmlExport.ts`**（纯函数，无 React / 无 DOM 依赖）

```ts
// 剥离模型输出可能包裹的 ```html 围栏（由 IframeRenderer 与下载共用）
export function cleanMarkdownCodeBlock(content: string): string;

// 清洗 + 保证 <meta charset="utf-8"> 与 <title>，产出可直接落盘的完整 HTML
// charset：<head> 内已存在任意 charset 声明则不动，否则在 <head> 开头注入
// title：已存在非空 <title> 则保留，否则用解码后的 path 注入
export function buildDownloadHtml(streamData: string, path: string): string;

// 用户路径 → 文件系统安全的文件名（含 .html 后缀）
export function buildDownloadFileName(path: string): string;
```

**`app/ui/hooks/useHtmlDownload.ts`**

```ts
export function useHtmlDownload(params: {
  streamData: string;
  path: string;
}): {
  download: () => void;
  justDownloaded: boolean; // 用于按钮短暂显示"已保存"反馈，2 秒后复位
};
```

**`app/api/download/route.ts`**

```
POST /api/download
Body: { path: string; fileName: string; byteSize: number }
Resp: { success: boolean; message: string }  // 恒定 200，异常静默吞掉
```

## 数据流

```
useStreamData
  └─ streamData / renderStage
       └─ StreamRenderer（附加 path）
            └─ DraggableLoadingIndicator（下载按钮）
                 └─ useHtmlDownload.download()
                      ├─ 主路：buildDownloadHtml → Blob → <a download>.click() → 落盘
                      └─ 旁路：fetch('/api/download', { keepalive: true }).catch(() => {})
                                  └─ prisma.downloadRecord.create()
```

两条支路互不阻塞。主路不依赖网络和数据库。

## 数据模型

```prisma
model DownloadRecord {
  id        String   @id @default(cuid())
  path      String
  fileName  String
  byteSize  Int
  userAgent String?
  ip        String?
  createdAt DateTime @default(now())

  @@index([path])
  @@index([createdAt])
  @@map("download_records")
}
```

字段与现有 `SearchRecord`（`prisma/schema.prisma:50`）同构。两个索引支撑按路径聚合和按时间切片两类复盘查询。

## 文件名规则

输入是用户任意输入且经过 URL 编码的 `path`，必须做安全处理：

1. `decodeURIComponent`（失败则用原串）
2. `/` 替换为 `-`
3. 剔除 `\ / : * ? " < > |` 及 ASCII 控制字符
4. 折叠连续空白，去除首尾 `.` 和空格（避免 Windows 下的非法名）
5. 截断到 100 字符
6. 结果为空则回退 `any-website-page`
7. 拼接 `.html`

示例：`魔法世界/霍格沃茨` → `魔法世界-霍格沃茨.html`

## 已知实现风险

**按钮在浮标两种形态下都要存在。** 浮标在 `isLoading` 为真时渲染加载卡片（`DraggableLoadingIndicator.tsx:244`），
为假时渲染"生成完成"卡片（同文件 258 行）。下载按钮放在卡片底部、"拖拽移动位置"提示之上，两种形态共用同一段
JSX，靠 `disabled={isLoading || !streamData}` 区分置灰与可点，避免写两份按钮。

**拖动与点击冲突。** 浮标外层在 `DraggableLoadingIndicator.tsx:235` 绑定了 `onMouseDown={handleMouseDown}`，
按钮直接嵌入会导致按下即进入拖动态，抬起时 click 可能不触发。

处理：按钮标记 `data-no-drag` 属性；`handleMouseDown` 与 `handleTouchStart` 开头判断
`(e.target as HTMLElement).closest('[data-no-drag]')` 命中则直接 return；按钮自身 `onClick` 内
`e.stopPropagation()`。

**Safari 提前回收 object URL。** `URL.revokeObjectURL` 必须延迟到 `setTimeout` 回调中执行，
立即调用会导致下载到空文件。

## 错误处理

- 数据库为可选配置（README 第 100 行）。埋点接口内部 try/catch，任何异常都返回 200 并只写 `console.error`，
  绝不影响下载。
- 客户端埋点 `fetch` 挂 `.catch(() => {})`，完全静默。
- 埋点接口复用 `isValidSearchPath`（`app/lib/pathFilter.ts:181`）过滤爬虫路径，与 trending 接口一致。
- `streamData` 为空时按钮不可点，不会产生空文件。

## 验证方式

项目无测试框架（`package.json` 仅有 `lint`），采用静态检查 + 手动验证：

1. `pnpm lint` 通过
2. `pnpm build` 通过
3. 手动：生成中按钮置灰不可点
4. 手动：生成完成后点击，得到能在浏览器正常打开的 HTML 文件，中文不乱码
5. 手动：拖动浮标不误触下载
6. 手动：路径含 `/` 和中文时文件名正确
7. 手动：数据库未配置时下载仍正常工作
