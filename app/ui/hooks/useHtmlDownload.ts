"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildDownloadFileName,
  buildDownloadHtml,
} from "@/app/lib/htmlExport";

interface UseHtmlDownloadParams {
  streamData: string;
  path: string;
}

function decodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

export function useHtmlDownload({ streamData, path }: UseHtmlDownloadParams): {
  download: () => void;
  justDownloaded: boolean;
} {
  const [justDownloaded, setJustDownloaded] = useState(false);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    };
  }, []);

  const download = useCallback(() => {
    if (!streamData) return;

    const html = buildDownloadHtml(streamData, path);
    const fileName = buildDownloadFileName(path);
    // 使用附件类型，避免 iOS Safari / WKWebView 将 HTML 当作可预览页面，
    // 忽略 download 属性后直接在当前标签打开 blob URL。
    const blob = new Blob([html], { type: "application/octet-stream" });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = objectUrl;
    anchor.download = fileName;
    // 移动浏览器若不支持 blob 下载，最多在新标签中预览，不能替换当前页面。
    anchor.target = "_blank";
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    // Safari 可能尚未读取完 object URL，延迟回收以避免生成空文件。
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);

    setJustDownloaded(true);
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => {
      setJustDownloaded(false);
      feedbackTimerRef.current = null;
    }, 2000);

    if (process.env.NODE_ENV === "production") {
      fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: decodePath(path),
          fileName,
          byteSize: blob.size,
        }),
        keepalive: true,
      }).catch(() => {});
    }
  }, [path, streamData]);

  return { download, justDownloaded };
}
