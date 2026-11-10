"use client";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { SOCIAL_SOURCE_LABELS, type Suggestion } from "@/app/lib/discovery";
import { sanitizeRandomWordHistory } from "@/app/lib/randomWord";

// 本地存储键名
const RANDOM_WORDS_KEY = "random_words_history";
const MAX_WORDS = 100;
const CONTACT_QR_URL = process.env.NEXT_PUBLIC_CONTACT_QR_URL?.trim();
const HOT_SEARCH_PREVIEW_LIMIT = 5;
const HOT_SEARCH_LIMIT = 12;

function ExternalLinkIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      className="h-5 w-5 shrink-0 text-[#d6cfc5] transition-all duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-[#d94f2b]"
    >
      <path
        d="M7 17 17 7M9 7h8v8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HotSearchRow({ item }: { item: Suggestion }) {
  const segments = item.path.split("/");
  const keyword = segments.at(-1);
  const parentPath = segments.slice(0, -1).join("/");

  return (
    <li className="border-b border-[#e7e0d6]">
      <Link
        href={`/${segments.map(encodeURIComponent).join("/")}`}
        target="_blank"
        rel="noopener noreferrer"
        title={item.path}
        className="group flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-[#f0e9de]/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#d94f2b] sm:px-5"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium text-[#1c1917] group-hover:text-[#a63c21]">{keyword}</span>
          {parentPath && <span className="mt-0.5 block truncate text-xs text-[#78716c]">/{parentPath}</span>}
        </span>
        {item.source !== 'local' && (
          <span className="shrink-0 text-right text-xs text-[#57534e]">
            {SOCIAL_SOURCE_LABELS[item.source]}
            {item.fetchedAt && (
              <time dateTime={item.fetchedAt} className="mt-0.5 block text-[11px] text-[#78716c]">
                {new Date(item.fetchedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 获取
              </time>
            )}
          </span>
        )}
        <ExternalLinkIcon />
      </Link>
    </li>
  );
}

function HotSearchSection({ source, title }: { source: 'website' | 'social'; title: string }) {
  const [trendingSearches, setTrendingSearches] = useState<Suggestion[]>([]);
  const [isLoadingTrending, setIsLoadingTrending] = useState(true);
  const [trendingError, setTrendingError] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const titleId = `hot-search-${source}`;
  const moreId = `${titleId}-more`;
  const additionalItems = trendingSearches.slice(HOT_SEARCH_PREVIEW_LIMIT);

  const fetchTrendingSearches = useCallback(async () => {
    try {
      setIsLoadingTrending(true);
      setTrendingError(false);
      const response = await fetch(`/api/trending?source=${source}&limit=${HOT_SEARCH_LIMIT}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('热门搜索暂不可用');
      const { data }: { data: Suggestion[] } = await response.json();
      setTrendingSearches(data.slice(0, HOT_SEARCH_LIMIT));
      if (data.length <= HOT_SEARCH_PREVIEW_LIMIT) setIsExpanded(false);
    } catch (error) {
      setTrendingError(true);
      console.error('获取热门搜索失败:', error);
    } finally {
      setIsLoadingTrending(false);
    }
  }, [source]);

  useEffect(() => {
    fetchTrendingSearches();
  }, [fetchTrendingSearches]);

  return (
    <section aria-labelledby={titleId} className="min-w-0 border border-[#e7e0d6] bg-[#faf6f0]/80">
      <header className="border-b border-[#e7e0d6] px-4 pb-4 pt-3 sm:px-5">
        <div className="flex items-center justify-between gap-3">
          <h3 id={titleId} className="text-2xl font-bold tracking-tight text-[#1c1917]">{title}</h3>
          <button
            type="button"
            aria-label={`刷新${title}`}
            onClick={fetchTrendingSearches}
            disabled={isLoadingTrending}
            className="min-h-11 min-w-11 shrink-0 px-1 text-[13px] text-[#78716c] hover:text-[#a63c21] focus-visible:outline-2 focus-visible:outline-[#d94f2b] disabled:opacity-60"
          >
            {isLoadingTrending ? '加载中...' : '刷新'}
          </button>
        </div>
        <p className="text-sm text-[#78716c]">
          {source === 'website' ? '来自本站访客的探索' : '来自微博、B 站和抖音的热门短词'}
        </p>
      </header>
      {trendingSearches.length > 0 ? (
        <>
          <ul role="list" className={additionalItems.length ? undefined : '[&>li:last-child]:border-b-0'}>
            {trendingSearches.slice(0, HOT_SEARCH_PREVIEW_LIMIT).map(item => <HotSearchRow key={item.path} item={item} />)}
          </ul>
          {additionalItems.length > 0 && (
            <>
              <button
                type="button"
                aria-expanded={isExpanded}
                aria-controls={moreId}
                onClick={() => setIsExpanded(expanded => !expanded)}
                className="flex min-h-11 w-full items-center justify-between gap-3 px-4 text-left text-sm font-medium text-[#a63c21] hover:bg-[#f0e9de]/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#d94f2b] sm:px-5"
              >
                <span>
                  {isExpanded ? '收起' : '查看更多'}
                  {!isExpanded && <span className="ml-2 text-xs font-normal text-[#78716c]">{additionalItems.length} 条</span>}
                </span>
                <svg aria-hidden="true" className={`h-4 w-4 ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 16 16">
                  <path d="m4 6 4 4 4-4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <ul id={moreId} role="list" hidden={!isExpanded} className="border-t border-[#e7e0d6] [&>li:last-child]:border-b-0">
                {isExpanded && additionalItems.map(item => <HotSearchRow key={item.path} item={item} />)}
              </ul>
            </>
          )}
          {trendingError && (
            <p role="status" className="border-t border-[#e7e0d6] px-4 py-3 text-sm text-[#78716c] sm:px-5">
              刷新失败，暂时显示上次结果。
            </p>
          )}
        </>
      ) : (
        <p role="status" className="px-4 py-10 text-center text-sm text-[#78716c] sm:px-5">
          {isLoadingTrending ? '正在加载热词…' : trendingError ? '热词暂时无法加载，请刷新重试。' : source === 'website' ? '本站暂时没有热词，试试上方的自由探索。' : '暂时没有可展示的社会热词。'}
        </p>
      )}
    </section>
  );
}

export default function Home() {
  const currentYear = new Date().getFullYear();
  const [searchPath, setSearchPath] = useState("");
  const [isLoadingRandom, setIsLoadingRandom] = useState(false);
  const [randomWordsHistory, setRandomWordsHistory] = useState<string[]>([]);
  const [isContactPinned, setIsContactPinned] = useState(false);
  const [isContactHovered, setIsContactHovered] = useState(false);
  const [isContactFocused, setIsContactFocused] = useState(false);
  const contactRef = useRef<HTMLDivElement>(null);
  const isContactOpen = isContactPinned || isContactHovered || isContactFocused;

  // 从本地存储加载历史记录
  useEffect(() => {
    try {
      const saved = localStorage.getItem(RANDOM_WORDS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        const words = sanitizeRandomWordHistory(parsed, MAX_WORDS);
        setRandomWordsHistory(words);

        // 清掉旧版本误存的提示词、英文句子和思考内容，避免继续污染后续请求
        if (JSON.stringify(parsed) !== JSON.stringify(words)) {
          localStorage.setItem(RANDOM_WORDS_KEY, JSON.stringify(words));
        }
      }
    } catch (error) {
      console.error("加载随机词汇历史失败:", error);
    }
  }, []);

  // 点击浮层外部或按 Escape 时关闭已固定的二维码浮层
  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!contactRef.current?.contains(event.target as Node)) {
        setIsContactPinned(false);
        setIsContactFocused(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsContactPinned(false);
        setIsContactHovered(false);
        setIsContactFocused(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  // 保存词汇到本地存储
  const saveWordToHistory = (word: string) => {
    try {
      const newHistory = [word, ...randomWordsHistory.filter(w => w !== word)].slice(0, MAX_WORDS);
      setRandomWordsHistory(newHistory);
      localStorage.setItem(RANDOM_WORDS_KEY, JSON.stringify(newHistory));
    } catch (error) {
      console.error("保存随机词汇历史失败:", error);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (searchPath.trim()) {
      const cleanPath = searchPath.trim().startsWith('/') ? searchPath.trim().slice(1) : searchPath.trim();
      window.open(`/${cleanPath}`, '_blank', 'noopener,noreferrer');
    }
  };

  const handleGetRandomWord = async () => {
    try {
      setIsLoadingRandom(true);
      const response = await fetch("/api/light-me", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history: randomWordsHistory }),
      });
      if (!response.ok) throw new Error(`请求失败: ${response.status}`);
      const data = await response.json();
      if (data.word) {
        setSearchPath(data.word);
        saveWordToHistory(data.word);
      } else {
        throw new Error("未获取到随机词汇");
      }
    } catch (error) {
      console.error("获取随机词汇失败:", error);
      alert("获取随机词汇失败，请重试");
    } finally {
      setIsLoadingRandom(false);
    }
  };

  return (
    <div className="font-display bg-grain" style={{ background: 'linear-gradient(180deg, #faf6f0 0%, #f5ede3 40%, #faf6f0 100%)' }}>

      {/* ===== 导航 ===== */}
      <nav className="sticky top-0 z-50 backdrop-blur-md" style={{ background: 'rgba(250, 246, 240, 0.85)', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
        <div className="max-w-5xl mx-auto px-5 sm:px-8 flex items-center justify-between h-14">
          <span className="text-[15px] font-bold tracking-tight text-[#1c1917]">
            网站任意门
          </span>
          <div className="flex h-full items-center gap-4 sm:gap-6">
            {CONTACT_QR_URL && (
              <div
                ref={contactRef}
                className="relative flex h-full items-center"
                onPointerEnter={(event) => {
                  if (event.pointerType !== "touch") setIsContactHovered(true);
                }}
                onPointerLeave={(event) => {
                  if (event.pointerType !== "touch") setIsContactHovered(false);
                }}
                onFocusCapture={() => setIsContactFocused(true)}
                onBlurCapture={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setIsContactFocused(false);
                  }
                }}
              >
                <button
                  type="button"
                  aria-expanded={isContactOpen}
                  aria-controls="contact-qr-popover"
                  aria-haspopup="dialog"
                  aria-label="查看 JiaHim 的小红书二维码"
                  onClick={() => {
                    setIsContactPinned((isPinned) => {
                      if (isPinned) setIsContactFocused(false);
                      return !isPinned;
                    });
                  }}
                  className={`inline-flex h-full items-center gap-1.5 text-[13px] transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d94f2b]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#faf6f0] ${
                    isContactOpen ? "text-[#1c1917]" : "text-[#a8a29e] hover:text-[#1c1917]"
                  }`}
                >
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#d94f2b]" />
                  找到我
                </button>

                <div
                  id="contact-qr-popover"
                  role="dialog"
                  aria-label="JiaHim 的小红书二维码"
                  aria-hidden={!isContactOpen}
                  className={`absolute right-0 top-full z-50 w-[min(17rem,calc(100vw-2.5rem))] origin-top-right pt-2 transition-all duration-200 ${
                    isContactOpen
                      ? "pointer-events-auto translate-y-0 opacity-100"
                      : "pointer-events-none -translate-y-1 opacity-0"
                  }`}
                >
                  <div className="overflow-hidden border border-black/10 bg-white p-1.5 shadow-[0_18px_50px_rgba(28,25,23,0.18)]">
                    {isContactOpen && (
                      <Image
                        src={CONTACT_QR_URL}
                        alt="JiaHim（科技版）的小红书二维码，小红书号 sam12138"
                        width={987}
                        height={1347}
                        sizes="(max-width: 640px) calc(100vw - 2.5rem), 17rem"
                        className="mx-auto block h-auto max-h-[calc(100dvh-5rem)] w-auto max-w-full object-contain"
                        draggable={false}
                        unoptimized
                      />
                    )}
                  </div>
                </div>
              </div>
            )}

            <a
              href="https://github.com/xiexin12138/any-website"
              className="text-[13px] text-[#a8a29e] hover:text-[#1c1917] transition-colors duration-300"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub &rarr;
            </a>
          </div>
        </div>
      </nav>

      {/* ===== Hero ===== */}
      <section className="relative max-w-5xl mx-auto px-5 sm:px-8 pt-20 sm:pt-32 pb-16 sm:pb-24">
        {/* 装饰线条 */}
        <div className="absolute top-12 right-8 sm:right-12 w-px h-20 sm:h-32" style={{ background: 'linear-gradient(180deg, transparent, #d6cfc5, transparent)' }} />
        <div className="absolute top-16 right-14 sm:right-20 w-16 sm:w-24 h-px" style={{ background: 'linear-gradient(90deg, transparent, #d6cfc5, transparent)' }} />

        {/* 小标签 */}
        <p className="text-[12px] sm:text-[13px] tracking-[0.15em] uppercase text-[#a8a29e] mb-6 sm:mb-8">
          AI-Powered Web Explorer
        </p>

        {/* 主标题 — 极端字号对比 */}
        <h1 className="text-[#1c1917] leading-[0.95] tracking-tight mb-6 sm:mb-8">
          <span className="block text-[clamp(3rem,8vw,6.5rem)] font-bold">
            输入路径
          </span>
          <span className="block text-[clamp(3rem,8vw,6.5rem)] font-bold mt-1">
            创造
            <span className="text-[#d94f2b]">世界</span>
          </span>
        </h1>

        {/* 副标题 — 轻字重，大反差 */}
        <p className="text-[15px] sm:text-[17px] font-light text-[#78716c] max-w-md leading-relaxed mb-10 sm:mb-14">
          一个神奇的任意门。输入任何你能想象的路径，AI 即刻为你生成独一无二的网页。去哪里，由你决定。
        </p>

        {/* 搜索框 */}
        <form onSubmit={handleSearch} className="max-w-lg mb-5">
          <div className="flex items-center border-b-2 border-[#1c1917] pb-1">
            <span className="text-[#a8a29e] text-sm font-mono mr-1 select-none">/</span>
            <input
              type="text"
              value={searchPath}
              onChange={(e) => setSearchPath(e.target.value)}
              placeholder="今晚吃什么"
              aria-describedby="search-recommendation-notice"
              className="flex-1 bg-transparent py-3 text-[#1c1917] text-lg sm:text-xl font-medium placeholder:text-[#d6cfc5] placeholder:font-light focus:outline-none"
            />
            <button
              type="button"
              onClick={handleGetRandomWord}
              disabled={isLoadingRandom}
              className="px-3 py-2 text-[#a8a29e] hover:text-[#d94f2b] disabled:opacity-30 transition-colors duration-300"
              title="随机灵感"
            >
              {isLoadingRandom ? (
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 00-3.7-3.7 48.678 48.678 0 00-7.324 0 4.006 4.006 0 00-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3l-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 003.7 3.7 48.656 48.656 0 007.324 0 4.006 4.006 0 003.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3l-3 3" />
                </svg>
              )}
            </button>
            <button
              type="submit"
              className="ml-2 px-5 py-2 bg-[#1c1917] text-[#faf6f0] text-sm font-bold tracking-wide rounded-none hover:bg-[#d94f2b] active:scale-[0.97] transition-all duration-300"
            >
              探索
            </button>
          </div>
          <p id="search-recommendation-notice" className="mt-3 text-[12px] leading-relaxed text-[#78716c]">
            你输入的内容可能会被推荐到首页，请勿填写个人隐私或敏感信息。
          </p>
        </form>

        {/* 辅助信息 */}
        <div className="flex items-center gap-4 text-[12px] text-[#a8a29e]">
          <span>点击旋转图标获取随机灵感</span>
          {randomWordsHistory.length > 0 && (
            <>
              <span className="w-px h-3" style={{ background: '#d6cfc5' }} />
              <button
                onClick={() => alert(`最近探索的领域：${randomWordsHistory.join('、')}`)}
                className="text-[#d94f2b] hover:underline underline-offset-2 transition-all duration-300"
              >
                历史记录 ({randomWordsHistory.length})
              </button>
            </>
          )}
        </div>
      </section>

      <section aria-labelledby="explore-title" className="mx-auto max-w-5xl px-5 pb-20 sm:px-8 sm:pb-28">
        <header className="mb-8 sm:mb-10">
          <p className="mb-2 text-[12px] uppercase tracking-[0.15em] text-[#a8a29e]">Explore</p>
          <h2 id="explore-title" className="mb-3 text-2xl font-bold tracking-tight text-[#1c1917] sm:text-3xl">不知道去哪？</h2>
          <p className="text-[15px] font-light text-[#78716c]">点击任意路径，开启一段新旅程。</p>
        </header>

        <div className="grid items-start gap-6 md:grid-cols-2">
          <HotSearchSection source="website" title="本站热词" />
          <HotSearchSection source="social" title="社会热词" />
        </div>
      </section>

      {/* ===== CTA ===== */}
      <section className="max-w-5xl mx-auto px-5 sm:px-8 pb-20 sm:pb-28">
        <div className="relative overflow-hidden py-14 sm:py-20 px-6 sm:px-12" style={{ background: '#1c1917' }}>
          {/* 装饰 */}
          <div className="absolute top-0 right-0 w-40 sm:w-64 h-40 sm:h-64 opacity-10" style={{
            background: 'radial-gradient(circle, #d94f2b 0%, transparent 70%)',
          }} />
          <div className="absolute bottom-0 left-0 w-32 h-32 opacity-5" style={{
            background: 'radial-gradient(circle, #d94f2b 0%, transparent 70%)',
          }} />

          <div className="relative">
            <p className="text-[12px] tracking-[0.15em] uppercase text-[#a8a29e] mb-4">Ready?</p>
            <h2 className="text-3xl sm:text-5xl font-bold text-[#faf6f0] tracking-tight mb-4 sm:mb-6 leading-tight">
              你的下一个页面<br/>正在等你
            </h2>
            <p className="text-[15px] text-[#78716c] font-light mb-8 max-w-md">
              输入任何你能想象的路径。或者，让 AI 给你一个随机灵感。
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/今晚吃什么"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block px-6 py-3 bg-[#d94f2b] text-[#faf6f0] text-sm font-bold tracking-wide hover:bg-[#c43d25] active:scale-[0.97] transition-all duration-300"
              >
                今晚吃什么 &rarr;
              </Link>
              <Link
                href="/三体/水滴"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block px-6 py-3 border border-[#44403c] text-[#a8a29e] text-sm font-medium hover:text-[#faf6f0] hover:border-[#78716c] transition-all duration-300"
              >
                三体 / 水滴
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ===== 页脚 ===== */}
      <footer style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
        <div className="max-w-5xl mx-auto px-5 sm:px-8">
          <div className="py-10 sm:py-12">
            <p className="mb-5 text-[11px] uppercase tracking-[0.15em] text-[#a8a29e]">
              顺路看看
            </p>
            <nav aria-label="友情链接" className="grid gap-px overflow-hidden border border-[#e7e0d6] bg-[#e7e0d6]">
              <a
                href="https://www.jiahim.com"
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center justify-between gap-5 bg-[#faf6f0] px-5 py-5 transition-colors duration-300 hover:bg-white sm:px-6 sm:py-6"
              >
                <span>
                  <span className="block text-[11px] uppercase tracking-[0.12em] text-[#a8a29e]">
                    我的主页
                  </span>
                  <span className="mt-1.5 block text-[15px] font-medium text-[#1c1917]">
                    JiaHim 的数字自留地
                  </span>
                </span>
                <ExternalLinkIcon />
              </a>
            </nav>
          </div>

          <div className="flex flex-col items-center justify-between gap-4 border-t border-black/[0.06] py-8 sm:flex-row sm:py-10">
            <span className="text-[13px] text-[#a8a29e]">
              &copy; {currentYear} 网站任意门
            </span>
            <a
              href="https://github.com/xiexin12138/any-website"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[13px] text-[#a8a29e] transition-colors duration-300 hover:text-[#1c1917]"
            >
              GitHub &rarr;
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
