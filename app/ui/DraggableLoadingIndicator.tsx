"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePageFeedback } from "./hooks/usePageFeedback";
import { useHtmlDownload } from "./hooks/useHtmlDownload";

interface DraggableLoadingIndicatorProps {
  isLoading: boolean;
  streamData: string;
  renderStage: "designing" | "coding" | "completed";
  path: string;
  generationId: string | null;
  onRegenerate: () => void;
}

type DockSide = "left" | "right";

const VIEWPORT_PADDING = 8;
const DRAG_THRESHOLD = 6;
const EDGE_COLLAPSE_DISTANCE = 20;
const STORAGE_KEY = "any-website:code-indicator";

export default function DraggableLoadingIndicator({
  isLoading,
  streamData,
  renderStage,
  path,
  generationId,
  onRegenerate,
}: DraggableLoadingIndicatorProps) {
  const feedback = usePageFeedback(generationId);
  const { download, justDownloaded } = useHtmlDownload({ streamData, path });
  const [isDragging, setIsDragging] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [dockSide, setDockSide] = useState<DockSide>("right");

  const isDraggingRef = useRef(false);
  const didDragRef = useRef(false);
  const positionRef = useRef({ x: 20, y: 20 });
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const dragStartRef = useRef({ x: 0, y: 0 });
  const activePointerIdRef = useRef<number | null>(null);
  const pointerCleanupRef = useRef<(() => void) | null>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);

  const applyPosition = useCallback((x: number, y: number) => {
    positionRef.current = { x, y };
    if (indicatorRef.current) {
      indicatorRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }
  }, []);

  const clampPosition = useCallback((x: number, y: number) => {
    const width = indicatorRef.current?.offsetWidth ?? 220;
    const height = indicatorRef.current?.offsetHeight ?? 120;
    const maxX = Math.max(VIEWPORT_PADDING, window.innerWidth - width - VIEWPORT_PADDING);
    const maxY = Math.max(VIEWPORT_PADDING, window.innerHeight - height - VIEWPORT_PADDING);

    return {
      x: Math.max(VIEWPORT_PADDING, Math.min(x, maxX)),
      y: Math.max(VIEWPORT_PADDING, Math.min(y, maxY)),
    };
  }, []);

  const moveToDock = useCallback((side: DockSide) => {
    const width = indicatorRef.current?.offsetWidth ?? 52;
    const next = clampPosition(
      side === "left"
        ? VIEWPORT_PADDING
        : window.innerWidth - width - VIEWPORT_PADDING,
      positionRef.current.y,
    );
    applyPosition(next.x, next.y);
  }, [applyPosition, clampPosition]);

  const persistPreference = useCallback((collapsed: boolean, side: DockSide) => {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ collapsed, side, y: positionRef.current.y }),
      );
    } catch {
      // 隐私模式或禁用本地存储时，交互仍可正常使用。
    }
  }, []);

  const changeCollapsedState = useCallback((collapsed: boolean, side: DockSide) => {
    setDockSide(side);
    setIsCollapsed(collapsed);
    persistPreference(collapsed, side);

    // 等待新的尺寸进入布局，再按同一侧重新定位，让面板始终向屏幕内展开。
    requestAnimationFrame(() => {
      requestAnimationFrame(() => moveToDock(side));
    });
  }, [moveToDock, persistPreference]);

  const collapse = useCallback(() => {
    const element = indicatorRef.current;
    const rect = element?.getBoundingClientRect();
    const side: DockSide = rect && rect.left + rect.width / 2 < window.innerWidth / 2
      ? "left"
      : "right";
    changeCollapsedState(true, side);
  }, [changeCollapsedState]);

  const expand = useCallback(() => {
    if (didDragRef.current) {
      didDragRef.current = false;
      return;
    }
    changeCollapsedState(false, dockSide);
  }, [changeCollapsedState, dockSide]);

  // 恢复用户上次选择的收起状态、停靠侧和纵向位置。
  useEffect(() => {
    try {
      const storedValue = window.localStorage.getItem(STORAGE_KEY);
      if (!storedValue) return;
      const stored = JSON.parse(storedValue) as {
        collapsed?: boolean;
        side?: DockSide;
        y?: number;
      };
      const side: DockSide = stored.side === "left" ? "left" : "right";
      if (typeof stored.y === "number" && Number.isFinite(stored.y)) {
        positionRef.current.y = stored.y;
      }
      setDockSide(side);
      setIsCollapsed(Boolean(stored.collapsed));
      requestAnimationFrame(() => moveToDock(side));
    } catch {
      // 忽略损坏或不可读取的偏好数据。
    }
  }, [moveToDock]);

  // 窗口缩放或移动端旋转后，把浮标留在安全区域内。
  useEffect(() => {
    const keepInViewport = () => {
      if (isCollapsed) {
        moveToDock(dockSide);
        return;
      }
      const next = clampPosition(positionRef.current.x, positionRef.current.y);
      applyPosition(next.x, next.y);
    };

    keepInViewport();
    window.addEventListener("resize", keepInViewport);
    const observer = new ResizeObserver(keepInViewport);
    if (indicatorRef.current) observer.observe(indicatorRef.current);
    return () => { window.removeEventListener("resize", keepInViewport); observer.disconnect(); };
  }, [applyPosition, clampPosition, dockSide, isCollapsed, moveToDock]);

  // Escape 是桌面端的快速收起方式。
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isCollapsed) collapse();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [collapse, isCollapsed]);

  const updatePosition = useCallback((clientX: number, clientY: number) => {
    if (
      Math.hypot(
        clientX - dragStartRef.current.x,
        clientY - dragStartRef.current.y,
      ) > DRAG_THRESHOLD
    ) {
      didDragRef.current = true;
    }

    const next = clampPosition(
      clientX - dragOffsetRef.current.x,
      clientY - dragOffsetRef.current.y,
    );
    // 位置 ref 立即更新，确保极快手势在 pointerup 前也能正确判断吸边方向。
    positionRef.current = next;
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = requestAnimationFrame(() => {
      applyPosition(next.x, next.y);
    });
  }, [applyPosition, clampPosition]);

  const beginDrag = useCallback((clientX: number, clientY: number) => {
    if (!indicatorRef.current) return;
    const rect = indicatorRef.current.getBoundingClientRect();
    dragOffsetRef.current = {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
    dragStartRef.current = { x: clientX, y: clientY };
    didDragRef.current = false;
    isDraggingRef.current = true;
    setIsDragging(true);
  }, []);

  const finishDrag = useCallback(() => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    setIsDragging(false);
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
      applyPosition(positionRef.current.x, positionRef.current.y);
    }
    if (indicatorRef.current) indicatorRef.current.style.transition = "";

    const width = indicatorRef.current?.offsetWidth ?? 52;
    const distanceFromLeft = positionRef.current.x;
    const distanceFromRight = window.innerWidth - positionRef.current.x - width;

    if (isCollapsed) {
      const side: DockSide = distanceFromLeft <= distanceFromRight ? "left" : "right";
      setDockSide(side);
      moveToDock(side);
      persistPreference(true, side);
      return;
    }

    // 展开态拖到边缘并松手，也可直接缩成圆球。
    if (didDragRef.current && Math.min(distanceFromLeft, distanceFromRight) <= EDGE_COLLAPSE_DISTANCE) {
      changeCollapsedState(true, distanceFromLeft <= distanceFromRight ? "left" : "right");
      return;
    }
    persistPreference(false, dockSide);
  }, [applyPosition, changeCollapsedState, dockSide, isCollapsed, moveToDock, persistPreference]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("[data-no-drag]")) return;
    if (event.button !== 0) return;
    event.preventDefault();

    const pointerId = event.pointerId;
    activePointerIdRef.current = pointerId;
    if (indicatorRef.current) indicatorRef.current.style.transition = "none";
    beginDrag(event.clientX, event.clientY);

    // 在 pointerdown 同一时刻挂载监听，避免快速拖拽先于 React 状态更新结束。
    const handleNativeMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId || !isDraggingRef.current) return;
      moveEvent.preventDefault();
      updatePosition(moveEvent.clientX, moveEvent.clientY);
    };
    const cleanup = () => {
      document.removeEventListener("pointermove", handleNativeMove);
      document.removeEventListener("pointerup", handleNativeEnd);
      document.removeEventListener("pointercancel", handleNativeEnd);
      pointerCleanupRef.current = null;
    };
    const handleNativeEnd = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== pointerId) return;
      activePointerIdRef.current = null;
      cleanup();
      finishDrag();
    };

    pointerCleanupRef.current?.();
    pointerCleanupRef.current = cleanup;
    document.addEventListener("pointermove", handleNativeMove, { passive: false });
    document.addEventListener("pointerup", handleNativeEnd);
    document.addEventListener("pointercancel", handleNativeEnd);
  }, [beginDrag, finishDrag, updatePosition]);

  useEffect(() => () => {
    pointerCleanupRef.current?.();
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
  }, []);

  if (!isLoading && streamData.length === 0) return null;

  const stageStyles = {
    designing: {
      panel: "bg-[#faf6f0]/95 border-[#d6cfc5]",
      text: "text-[#d94f2b]",
      ringTrack: "border-[#d6cfc5]",
      ringActive: "border-t-[#d94f2b]",
      orb: "from-[#1c1917] to-[#44403c] shadow-[#1c1917]/25",
      title: "设计阶段 (1/2)",
      subtitle: "构思页面布局",
    },
    coding: {
      panel: "bg-[#faf6f0]/95 border-[#d6cfc5]",
      text: "text-[#1c1917]",
      ringTrack: "border-[#d6cfc5]",
      ringActive: "border-t-[#d94f2b]",
      orb: "from-[#d94f2b] to-[#b63821] shadow-[#d94f2b]/25",
      title: "编码阶段 (2/2)",
      subtitle: "编写 HTML 代码",
    },
    completed: {
      panel: "bg-[#faf6f0]/95 border-[#d6cfc5]",
      text: "text-[#1c1917]",
      ringTrack: "border-[#d6cfc5]",
      ringActive: "border-t-[#d94f2b]",
      orb: "from-[#d94f2b] to-[#b63821] shadow-[#d94f2b]/25",
      title: "生成完成",
      subtitle: "HTML 文件已准备好",
    },
  }[renderStage];

  return (
    <div
      ref={indicatorRef}
      className="fixed left-0 top-0 z-50 select-none touch-none transition-transform duration-300 ease-out motion-reduce:transition-none"
      style={{
        transform: `translate3d(${positionRef.current.x}px, ${positionRef.current.y}px, 0)`,
        willChange: "transform",
        backfaceVisibility: "hidden",
        cursor: isDragging ? "grabbing" : "grab",
        userSelect: "none",
        touchAction: "none",
      }}
      onPointerDown={handlePointerDown}
    >
      {isCollapsed ? (
        <div className="group relative">
          <button
            type="button"
            onClick={expand}
            className={`relative flex h-[52px] w-[52px] items-center justify-center overflow-hidden rounded-full bg-gradient-to-br ${stageStyles.orb} text-white shadow-lg transition-[transform,box-shadow] duration-200 hover:scale-105 hover:shadow-xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white focus-visible:ring-offset-2 active:scale-95 motion-reduce:transition-none`}
            aria-label={`${isLoading ? stageStyles.title : "生成完成"}，点击展开，可拖动调整位置`}
            aria-live="polite"
            title="点击展开，拖动调整位置"
          >
            {isLoading && (
              <span className="absolute inset-[5px] rounded-full border-2 border-white/35 border-t-white motion-safe:animate-spin" />
            )}
            <span className="relative z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-[11px] font-bold tracking-[-0.08em] backdrop-blur-sm">
              {isLoading ? "</>" : (
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </span>
            {!isLoading && (
              <span className="absolute right-0 top-0 h-3.5 w-3.5 rounded-full border-2 border-white bg-green-500" aria-hidden="true" />
            )}
          </button>

          <div
            className={`pointer-events-none absolute top-1/2 hidden -translate-y-1/2 whitespace-nowrap rounded-lg bg-gray-950/90 px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 sm:block ${
              dockSide === "right" ? "right-[60px]" : "left-[60px]"
            }`}
            aria-hidden="true"
          >
            {isLoading ? stageStyles.title : "生成完成"} · 点击展开
          </div>
        </div>
      ) : (
        <div className={`overflow-hidden rounded-2xl border shadow-xl backdrop-blur-sm transition-[width,height,transform,box-shadow] duration-300 motion-reduce:transition-none ${stageStyles.panel} ${
          isDragging ? "scale-[1.02] shadow-2xl" : ""
        }`}>
          <div className="w-[calc(100vw-2rem)] max-w-[260px] p-3.5 sm:w-[250px] sm:p-4">
            <div className="flex items-start gap-3">
              <div className="relative mt-0.5 flex h-9 w-9 flex-none items-center justify-center">
                {isLoading ? (
                  <>
                    <span className={`absolute inset-0 rounded-full border-2 ${stageStyles.ringTrack}`} />
                    <span className={`absolute inset-0 rounded-full border-2 border-transparent ${stageStyles.ringActive} motion-safe:animate-spin`} />
                    <span className={`text-[10px] font-bold tracking-[-0.08em] ${stageStyles.text}`}>{"</>"}</span>
                  </>
                ) : (
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100 text-green-600">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                )}
              </div>

              <div className="min-w-0 flex-1" aria-live="polite">
                <div className={`truncate text-sm font-semibold ${stageStyles.text}`}>
                  {isLoading ? stageStyles.title : "生成完成"}
                </div>
                <div className="mt-1 text-xs text-gray-600">
                  {isLoading ? stageStyles.subtitle : "HTML 文件已准备好"}
                </div>
              </div>

              <button
                type="button"
                data-no-drag
                onClick={(event) => {
                  event.stopPropagation();
                  collapse();
                }}
                className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-black/5 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-1"
                aria-label="收起并贴到屏幕边缘"
                title="收起并贴边（Esc）"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h8" />
                </svg>
              </button>
            </div>

            {!isLoading && renderStage === 'completed' && (
              <div data-no-drag className="mt-3 border-t border-[#e7e0d6] pt-3">
                <p className="mb-2 text-xs text-[#57534e]">这次生成的页面怎么样？</p>
                <div className="flex gap-2">
                  {([1, -1] as const).map(value => (
                    <button key={value} type="button" data-no-drag
                      aria-pressed={feedback.value === value}
                      aria-label={value === 1 ? (feedback.value === 1 ? '取消点赞' : '点赞') : (feedback.value === -1 ? '取消点踩' : '点踩')}
                      disabled={!generationId || !feedback.ready || feedback.pending}
                      onClick={() => void feedback.vote(value)}
                      className={`min-h-11 flex-1 rounded-xl border px-3 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d94f2b] ${feedback.value === value ? 'border-[#d94f2b] bg-[#f5e3dc] text-[#b63821]' : 'border-[#d6cfc5] text-[#57534e] hover:bg-white/60'}`}>
                      <span aria-hidden="true">{value === 1 ? '👍' : '👎'}</span> {value === 1 ? '点赞' : '点踩'}
                    </button>
                  ))}
                </div>
                <p role="status" className="mt-2 text-xs leading-relaxed text-[#57534e]">
                  {!generationId ? '本次评价暂不可用，可重新生成后再试' : feedback.pending ? '正在保存…' : feedback.message || (feedback.ready ? '再点一次取消，点另一项切换' : '正在读取评价…')}
                </p>
                {generationId && !feedback.ready && feedback.message && <button type="button" data-no-drag onClick={() => void feedback.retry()} className="min-h-11 text-xs text-[#b63821] underline">重试读取评价</button>}
                <button type="button" data-no-drag disabled={feedback.pending} onClick={onRegenerate} className="mt-1 min-h-11 text-xs text-[#57534e] underline underline-offset-4 disabled:opacity-50">重新生成一个页面</button>
              </div>
            )}

            <button
              type="button"
              data-no-drag
              disabled={isLoading || !streamData}
              onClick={(event) => {
                event.stopPropagation();
                download();
              }}
              className={`group mt-3 flex min-h-11 w-full items-center gap-2.5 rounded-full border px-3 py-2 text-[13px] font-medium transition-[transform,background-color,border-color,color,box-shadow] duration-300 ease-out sm:text-sm ${
                isLoading || !streamData
                  ? "cursor-not-allowed border-[#e7e0d6] bg-[#faf6f0]/80 text-[#a8a29e]"
                  : justDownloaded
                    ? "cursor-pointer border-[#d6cfc5] bg-[#faf6f0] text-[#57534e] hover:border-[#b9cdbd] hover:shadow-[0_2px_12px_rgba(47,125,70,0.1)] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-green-200 focus-visible:ring-offset-2 active:scale-[0.98]"
                    : "cursor-pointer border-[#e7e0d6] bg-[#faf6f0] text-[#57534e] hover:border-[#d94f2b] hover:bg-[#fffaf6] hover:text-[#d94f2b] hover:shadow-[0_2px_12px_rgba(217,79,43,0.1)] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[#d94f2b]/20 focus-visible:ring-offset-2 active:scale-[0.98]"
              }`}
              aria-label={
                justDownloaded
                  ? "页面已保存到本地"
                  : isLoading || !streamData
                    ? "HTML 正在生成，完成后可下载"
                    : "下载生成的 HTML 页面"
              }
              title={isLoading || !streamData ? "生成完成后即可下载 HTML 文件" : "下载 HTML 文件"}
            >
              <span
                aria-hidden="true"
                className={`flex h-7 w-7 flex-none items-center justify-center rounded-full transition-[transform,background-color,color] duration-300 ${
                  isLoading || !streamData
                    ? "bg-[#eee8df] text-[#a8a29e]"
                    : justDownloaded
                      ? "bg-[#e7f5e9] text-[#2f7d46] group-hover:scale-105"
                      : "bg-[#f5e3dc] text-[#d94f2b] group-hover:translate-y-0.5 group-hover:bg-[#d94f2b] group-hover:text-[#faf6f0] group-active:translate-y-1"
                }`}
              >
                {justDownloaded ? (
                  <span className="text-sm leading-none">✓</span>
                ) : (
                  <span className="relative h-4 w-4">
                    <span className="absolute left-[7px] top-0 h-2.5 w-0.5 rounded-full bg-current" />
                    <span className="absolute left-[4px] top-[4px] h-1.5 w-1.5 rotate-45 border-b-2 border-r-2 border-current" />
                    <span className="absolute bottom-0 left-0.5 h-0.5 w-3 rounded-full bg-current" />
                  </span>
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-left">
                {justDownloaded
                  ? "HTML 已保存"
                  : isLoading || !streamData
                    ? "生成完成后下载 HTML"
                    : "下载 HTML 文件"}
              </span>
            </button>

            <div className="mt-2.5 flex items-center justify-center gap-1.5 text-[11px] text-gray-500">
              <span className="grid grid-cols-2 gap-0.5" aria-hidden="true">
                <i className="h-0.5 w-0.5 rounded-full bg-current" />
                <i className="h-0.5 w-0.5 rounded-full bg-current" />
                <i className="h-0.5 w-0.5 rounded-full bg-current" />
                <i className="h-0.5 w-0.5 rounded-full bg-current" />
              </span>
              {isDragging ? "释放完成拖动" : "拖动浮标 · 靠边自动收起"}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
