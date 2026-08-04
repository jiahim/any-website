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
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = objectUrl;
    anchor.download = fileName;
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
