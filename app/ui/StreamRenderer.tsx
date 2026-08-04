"use client";

import { useEffect, useRef } from "react";
import { useStreamData } from "./hooks/useStreamData";
import IframeRenderer from "./components/IframeRenderer";
import DesignStageIndicator from "./components/DesignStageIndicator";
import StreamErrorDisplay from "./components/StreamErrorDisplay";
import DraggableLoadingIndicator from "./DraggableLoadingIndicator";

interface StreamRendererProps {
  path: string;
}

export default function StreamRenderer({ path }: StreamRendererProps) {
  const {
    isLoading,
    error,
    streamData,
    renderStage,
    currentStepIndex,
  } = useStreamData(path);
  
  const hasRecordedRef = useRef(false);
  
  // 当渲染完成时记录搜索数据
  useEffect(() => {
    if (renderStage === "completed" && !hasRecordedRef.current && process.env.NODE_ENV === 'production') {
      hasRecordedRef.current = true;
      
      // 记录搜索到热门搜索
      const recordSearch = async () => {
        try {
          await fetch('/api/trending', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              path: decodeURIComponent(path),
              category: '用户搜索'
            }),
          });
        } catch (error) {
          console.error('记录搜索失败:', error);
        }
      };
      
      recordSearch();
    }
  }, [renderStage, path]);
  
  // 重置记录状态当路径改变时
  useEffect(() => {
    hasRecordedRef.current = false;
  }, [path]);

  if (error) {
    return <StreamErrorDisplay error={error} />;
  }

  return (
    <>
      {/* 设计阶段界面 */}
      {renderStage === "designing" && isLoading && (
        <div className="px-4 py-8">
          <DesignStageIndicator currentStepIndex={currentStepIndex} />
        </div>
      )}

      {/* iframe 渲染容器 — 无间距，贴边显示 */}
      <IframeRenderer 
        streamData={streamData} 
        error={error} 
      />

      {/* 可拖动的加载浮标 — key={path} 确保路径变化时销毁旧实例 */}
      <DraggableLoadingIndicator
        key={path}
        isLoading={isLoading}
        streamData={streamData}
        renderStage={renderStage}
        path={path}
      />
    </>
  );
}
