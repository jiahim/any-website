import { useCallback, useEffect, useRef, useState } from 'react';
export type Vote = -1 | 0 | 1;
export function usePageFeedback(generationId: string | null) {
  const [value, setValue] = useState<Vote>(0);
  const [pending, setPending] = useState(false);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState('');
  const busy = useRef(false);
  const current = useRef(generationId);
  current.current = generationId;
  const load = useCallback(async () => {
    if (!generationId) return;
    setReady(false);
    setMessage('');
    try {
      const response = await fetch(`/api/feedback?generationId=${encodeURIComponent(generationId)}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || ![-1,0,1].includes(data.value)) throw new Error(data.message || '评价暂时无法读取');
      if (current.current !== generationId) return;
      setValue(data.value);
      setReady(true);
    } catch (error) {
      if (current.current === generationId) setMessage(error instanceof Error ? error.message : '评价暂时无法读取');
    }
  }, [generationId]);
  useEffect(() => { setValue(0); setReady(false); setMessage(''); void load(); }, [load]);
  const vote = async (selected: -1 | 1) => {
    if (!generationId || !ready || busy.current) return;
    const previous = value;
    const next: Vote = value === selected ? 0 : selected;
    busy.current = true;
    setPending(true);
    setValue(next);
    setMessage('');
    try {
      const response = await fetch('/api/feedback', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ generationId, value: next }) });
      const data = await response.json();
      if (!response.ok || ![-1,0,1].includes(data.value)) throw new Error(data.message || '评价未保存，请重试');
      if (current.current !== generationId) return;
      setValue(data.value);
      setMessage(data.value === 0 ? '已取消评价' : '评价已保存，再点一次可取消');
    } catch (error) {
      if (current.current === generationId) {
        setValue(previous);
        setMessage(error instanceof Error ? error.message : '评价未保存，请重试');
      }
    } finally { busy.current = false; if (current.current === generationId) setPending(false); }
  };
  return { value, pending, ready, message, vote, retry: load };
}
