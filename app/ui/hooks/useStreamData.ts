import { useCallback, useEffect, useState } from 'react';
import { DESIGN_STEPS } from '../constants/designSteps';
const CACHE_KEY = 'any-website:current-generation';
const CACHE_MS = 30 * 60_000;
export function useStreamData(path: string) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [streamData, setStreamData] = useState('');
  const [generationId, setGenerationId] = useState<string | null>(null);
  const [renderStage, setRenderStage] = useState<'designing' | 'coding' | 'completed'>('designing');
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [revision, setRevision] = useState(0);
  const regenerate = useCallback(() => {
    try { sessionStorage.removeItem(CACHE_KEY); } catch { /* optional cache */ }
    setRevision(value => value + 1);
  }, []);
  useEffect(() => {
    if (renderStage !== 'designing' || !isLoading) return;
    const timer = setInterval(() => setCurrentStepIndex(value => (value + 1) % DESIGN_STEPS.length), 2000);
    return () => clearInterval(timer);
  }, [renderStage, isLoading]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    setIsLoading(true); setError(null); setStreamData(''); setGenerationId(null); setRenderStage('designing'); setCurrentStepIndex(0);
    try {
      const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
      if (cached?.path === path && typeof cached.id === 'string' && /^[0-9a-f-]{36}$/i.test(cached.id) && typeof cached.html === 'string' && cached.html.length <= 1_000_000 && typeof cached.savedAt === 'number' && Date.now() >= cached.savedAt && Date.now() - cached.savedAt < CACHE_MS) {
        setGenerationId(cached.id); setStreamData(cached.html); setRenderStage('completed'); setIsLoading(false);
        return;
      }
    } catch { /* corrupted/unavailable cache falls back to normal generation */ }

    const run = async () => {
      let content = '', buffer = '', id: string | null = null;
      let completed = false;
      const processLine = (line: string) => {
        if (!line.startsWith('data:')) return;
        const payload = line.slice(5).trim();
        if (!payload) return;
        if (payload === '[DONE]') { completed = true; return; }
        const data = JSON.parse(payload);
        if (data.error) throw new Error('页面生成中断，请重试');
        if (data.generation) {
          id = typeof data.generation.id === 'string' ? data.generation.id : null;
          return;
        }
        const delta = data.choices?.[0]?.delta?.content;
        if (typeof delta !== 'string') return;
        content += delta;
        if (/<body[\s>]/i.test(content)) setRenderStage('coding');
        if (!flushTimer) flushTimer = setTimeout(() => { flushTimer = null; if (active) setStreamData(content); }, 300);
      };
      try {
        const response = await fetch('/api/stream', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, userAgent: navigator.userAgent }), signal: controller.signal });
        if (!response.ok) {
          const text = await response.text();
          let message = text || `API请求失败: ${response.status}`;
          try { message = JSON.parse(text).message || message; } catch { /* text error */ }
          throw new Error(message);
        }
        if (!response.body) throw new Error('响应不支持流式读取');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        while (active) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n'); buffer = lines.pop() || '';
          lines.forEach(processLine);
        }
        buffer += decoder.decode();
        if (buffer.trim()) processLine(buffer);
        if (!active) return;
        if (!completed || !content.trim()) throw new Error('页面生成未完成，请重新尝试');
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
        setStreamData(content); setGenerationId(id); setRenderStage('completed'); setIsLoading(false);
        if (id && content.length <= 1_000_000) {
          try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ path, id, html: content, savedAt: Date.now() })); } catch { /* storage limits do not affect rendering */ }
        }
      } catch (err) {
        if (!active) return;
        controller.abort();
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
        setError(err instanceof Error ? err.message : '未知错误'); setIsLoading(false);
      }
    };
    const timer = setTimeout(() => void run(), 100);
    return () => { active = false; clearTimeout(timer); if (flushTimer) clearTimeout(flushTimer); controller.abort(); };
  }, [path, revision]);
  return { isLoading, error, streamData, generationId, renderStage, currentStepIndex, regenerate };
}
