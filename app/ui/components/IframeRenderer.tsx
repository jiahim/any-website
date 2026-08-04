"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { cleanMarkdownCodeBlock } from "@/app/lib/htmlExport";

interface IframeRendererProps {
  streamData: string;
  error: string | null;
  onNavigate?: (href: string) => void;
}

/**
 * 注入到 iframe 内部的 body 样式重置
 * - 消除浏览器默认的 body margin（通常为 8px），避免 iframe 内部产生白边
 */
const BODY_RESET_STYLE = `<style>body{margin:0;padding:0}</style>`;

export default function IframeRenderer({
  streamData,
  error,
  onNavigate,
}: IframeRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeHeight, setIframeHeight] = useState<number>(200);
  const observerRef = useRef<ResizeObserver | null>(null);

  /**
   * 从父侧直接测量 iframe 内容高度
   * 由于 iframe 设置了 sandbox="allow-same-origin"，父页面可以直接访问 contentDocument，
   * 无需通过 postMessage 通信，也无需向 iframe 注入任何脚本
   */
  const measureHeight = useCallback((doc: Document) => {
    try {
      const h = doc.documentElement?.scrollHeight;
      if (typeof h === "number" && h > 0) {
        setIframeHeight(h);
      }
    } catch {
      // 忽略跨域访问错误
    }
  }, []);

  // 构建完整 HTML 内容（不注入任何脚本，避免流式渲染时脚本文本闪现）
  const buildContent = useCallback((): string => {
    if (error) {
      return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 16px; margin: 0; }
.error { background: #fef2f2; border: 1px solid #fecaca; padding: 16px; border-radius: 8px; color: #dc2626; }
.error h3 { margin: 0 0 8px; }
.error p { margin: 0; }
</style>
</head><body>
<div class="error"><h3>错误</h3><p>${error}</p></div>
</body></html>`;
    }

    if (!streamData) return "";

    let content = cleanMarkdownCodeBlock(streamData);

    // 注入 body 样式重置，消除浏览器默认 body margin
    // 在 </head> 前注入；如果没有 </head> 则在 <body 或内容开头注入
    if (content.includes("</head>")) {
      content = content.replace("</head>", `${BODY_RESET_STYLE}</head>`);
    } else if (content.includes("<body")) {
      content = content.replace("<body", `${BODY_RESET_STYLE}<body`);
    } else {
      content = BODY_RESET_STYLE + content;
    }

    return content;
  }, [streamData, error]);

  // 拦截 iframe 内链接点击，在父窗口导航而非 iframe 内部导航
  const handleLinkClick = useCallback((e: MouseEvent) => {
    const anchor = (e.target as HTMLElement).closest?.('a');
    if (!anchor) return;

    const href = anchor.getAttribute('href');
    if (!href) return;

    // 锚点链接保持 iframe 内跳转
    if (href.startsWith('#')) return;

    e.preventDefault();
    e.stopPropagation();

    onNavigate?.(href);
    window.location.href = href;
  }, [onNavigate]);

  // 通过 document.write 写入 iframe 内容，并从父侧监听高度变化
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const content = buildContent();
    if (!content) return;

    // 清理上一轮的 ResizeObserver
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }

    let linkClickHandler: ((e: MouseEvent) => void) | null = null;
    let iframeDoc: Document | null = null;

    try {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (doc) {
        doc.open();
        doc.write(content);
        doc.close();

        iframeDoc = doc;

        // 拦截 iframe 内所有链接点击，防止 iframe 内导航产生多个浮标
        linkClickHandler = handleLinkClick;
        doc.addEventListener('click', linkClickHandler, true);

        // 立即测量一次高度
        const measure = () => measureHeight(doc);
        measure();

        // 使用 ResizeObserver 从父侧监听 iframe 内容高度变化
        if (typeof ResizeObserver !== "undefined") {
          const observer = new ResizeObserver(measure);
          observer.observe(doc.documentElement);
          observerRef.current = observer;
        }

        // 监听 iframe 内部图片/字体加载完成后重新测量
        doc.addEventListener(
          "load",
          (e: Event) => {
            const target = e.target as HTMLElement;
            if (target?.tagName === "IMG" || target?.tagName === "LINK") {
              measure();
            }
          },
          true
        );
        if (doc.fonts) doc.fonts.ready.then(measure);

        // 延时兜底：确保 Tailwind CSS 异步处理后高度正确
        setTimeout(measure, 500);
        setTimeout(measure, 1500);
        setTimeout(measure, 3000);
      }
    } catch {
      // 如果 contentDocument 不可访问（跨域限制），回退到 srcdoc
      iframe.srcdoc = content;
    }

    return () => {
      if (linkClickHandler && iframeDoc) {
        try {
          iframeDoc.removeEventListener('click', linkClickHandler, true);
        } catch {
          // contentDocument 可能已不可访问
        }
      }
    };
  }, [buildContent, measureHeight, handleLinkClick]);

  // 组件卸载时清理 ResizeObserver
  useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, []);

  // 没有内容且没有错误时不渲染
  if (!streamData && !error) return null;

  return (
    <iframe
      ref={iframeRef}
      style={{
        width: "100%",
        height: `${iframeHeight}px`,
        border: "none",
        margin: 0,
        padding: 0,
        overflow: "hidden",
        display: "block",
      }}
      sandbox="allow-scripts allow-same-origin"
      title="AI 生成的页面内容"
    />
  );
}
