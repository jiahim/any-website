'use client';

import Image from 'next/image';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  feedbackLength, isScreenshotMimeType, MAX_FEEDBACK_LENGTH, MAX_SCREENSHOT_BYTES, SCREENSHOT_ACCEPT,
} from '@/app/lib/siteFeedback';

function encodeScreenshot(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const data = typeof reader.result === 'string' ? reader.result.split(',')[1] : '';
      if (data) resolve(data);
      else reject(new Error('无法读取截图，请重新选择'));
    };
    reader.onerror = reader.onabort = () => reject(new Error('无法读取截图，请重新选择'));
    reader.readAsDataURL(file);
  });
}

export default function SiteFeedback() {
  const dialog = useRef<HTMLDialogElement>(null);
  const messageInput = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const submissionId = useRef<string>(null);
  const sending = useRef(false);
  const [message, setMessage] = useState('');
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const length = feedbackLength(message);
  const tooLong = length > MAX_FEEDBACK_LENGTH;

  useEffect(() => {
    if (!screenshot) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(screenshot);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [screenshot]);

  function updateScreenshot(file: File | null) {
    submissionId.current = null;
    setSuccess('');
    if (file && (!isScreenshotMimeType(file.type) || file.size < 1 || file.size > MAX_SCREENSHOT_BYTES)) {
      setError('请选择一张不超过 2 MiB 的 PNG、JPEG 或 WebP 截图');
      setScreenshot(null);
      return;
    }
    setScreenshot(file);
    setError('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current || !length || tooLong) return;

    sending.current = true;
    setPending(true);
    setError('');
    setSuccess('');
    try {
      const id = submissionId.current ??= crypto.randomUUID();
      const attachment = screenshot
        ? { mimeType: screenshot.type, base64: await encodeScreenshot(screenshot) }
        : undefined;
      const response = await fetch('/api/site-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionId: id, message: message.trim(), screenshot: attachment }),
        signal: AbortSignal.timeout(45_000),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.success !== true) {
        setError(typeof result?.message === 'string' ? result.message : '暂时无法提交，请稍后重试');
        return;
      }
      setMessage('');
      setScreenshot(null);
      submissionId.current = null;
      setSuccess('已收到你的反馈，谢谢！');
      messageInput.current?.focus();
    } catch (error) {
      setError(error instanceof Error && error.message === '无法读取截图，请重新选择'
        ? error.message : '暂时无法提交，请检查网络后重试');
    } finally {
      sending.current = false;
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-controls="site-feedback"
        onClick={() => {
          dialog.current?.showModal();
          messageInput.current?.focus();
        }}
        className="inline-flex h-full items-center text-[13px] text-[#57534e] hover:text-[#d94f2b] focus-visible:outline-2 focus-visible:outline-[#d94f2b]"
      >
        意见反馈
      </button>
      <dialog
        ref={dialog}
        id="site-feedback"
        aria-labelledby="site-feedback-title"
        onCancel={event => { if (sending.current) event.preventDefault(); }}
        className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto border border-[#e7e0d6] bg-[#faf6f0] p-5 text-[#1c1917] shadow-2xl backdrop:bg-[#1c1917]/45 sm:p-7"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="site-feedback-title" className="text-xl font-bold">意见反馈</h2>
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            disabled={pending}
            className="min-h-11 px-2 text-sm text-[#57534e] hover:text-[#d94f2b] disabled:opacity-50"
          >
            关闭
          </button>
        </div>
        <p className="mt-1 text-sm leading-relaxed text-[#57534e]">
          留言和截图会发给站主。希望收到回复的话，可以在留言里留下联系方式。
        </p>
        <form onSubmit={submit} className="mt-5 space-y-4">
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <label htmlFor="site-feedback-message" className="text-sm font-semibold">留言</label>
              <span id="site-feedback-count" className={tooLong ? 'text-xs text-[#a82b18]' : 'text-xs text-[#57534e]'}>
                {length} / {MAX_FEEDBACK_LENGTH}
              </span>
            </div>
            <textarea
              ref={messageInput}
              id="site-feedback-message"
              aria-describedby="site-feedback-count"
              aria-invalid={tooLong}
              value={message}
              rows={4}
              required
              readOnly={pending}
              placeholder="有什么问题或建议？"
              onChange={event => {
                setMessage(event.target.value);
                submissionId.current = null;
                setError('');
                setSuccess('');
              }}
              className="block w-full resize-y border border-[#d6cfc5] bg-white p-3 text-base focus:outline-2 focus:outline-[#d94f2b]"
            />
            {tooLong && <p role="alert" className="mt-1 text-sm text-[#a82b18]">留言不能超过 500 字。</p>}
          </div>
          <div>
            <input
              ref={fileInput}
              type="file"
              accept={SCREENSHOT_ACCEPT}
              aria-label="选择截图"
              hidden
              onChange={event => {
                const file = event.target.files?.[0];
                if (file) updateScreenshot(file);
                event.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={pending}
              className="min-h-11 border border-[#d6cfc5] bg-white px-3 text-sm font-medium hover:border-[#d94f2b] disabled:opacity-50"
            >
              {screenshot ? '更换截图' : '添加截图'}
            </button>
            <p className="mt-2 text-xs leading-relaxed text-[#57534e]">
              选填，支持一张 PNG、JPEG 或 WebP，最大 2 MiB。请先遮盖截图里的个人信息。
            </p>
            {screenshot && (
              <div className="mt-3 flex items-center gap-3 border border-[#e7e0d6] bg-white p-2">
                {preview && (
                  <Image unoptimized src={preview} width={72} height={56} alt="截图预览"
                    className="h-14 w-[72px] shrink-0 object-contain" />
                )}
                <span className="min-w-0 flex-1 truncate text-xs" title={screenshot.name}>{screenshot.name}</span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => updateScreenshot(null)}
                  className="min-h-11 shrink-0 px-2 text-xs text-[#a82b18] underline disabled:opacity-50"
                >
                  移除截图
                </button>
              </div>
            )}
          </div>
          {error && <p role="alert" className="text-sm text-[#a82b18]">{error}</p>}
          {success && <p role="status" className="text-sm text-[#365644]">{success}</p>}
          <button
            type="submit"
            disabled={pending || !length || tooLong}
            className="min-h-11 bg-[#1c1917] px-5 text-sm font-bold text-[#faf6f0] hover:bg-[#a82b18] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? '正在发送…' : '发送反馈'}
          </button>
        </form>
      </dialog>
    </>
  );
}
