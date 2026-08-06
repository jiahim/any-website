"use client";

import Link from "next/link";
import { DESIGN_STEPS } from "../constants/designSteps";

interface DesignStageIndicatorProps {
  currentStepIndex: number;
  path: string;
}

function getDisplayPath(path: string) {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

export default function DesignStageIndicator({
  currentStepIndex,
  path,
}: DesignStageIndicatorProps) {
  const stepNumber = String(currentStepIndex + 1).padStart(2, "0");
  const displayPath = getDisplayPath(path);

  return (
    <main className="design-wait min-h-[100svh] overflow-hidden bg-[#faf6f0] text-[#1c1917]">
      <header className="border-b border-black/[0.06] bg-[#faf6f0]/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-5 sm:px-8">
          <Link
            href="/"
            className="text-[15px] font-bold tracking-tight transition-colors hover:text-[#d94f2b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d94f2b]/30"
          >
            网站任意门
          </Link>
          <div className="flex items-center gap-2 text-[11px] font-medium tracking-[0.14em] text-[#a8a29e] sm:text-[12px]">
            <span className="design-wait-pulse h-1.5 w-1.5 rounded-full bg-[#d94f2b]" />
            <span>BUILDING {stepNumber} / 04</span>
          </div>
        </div>
      </header>

      <section className="mx-auto grid min-h-[calc(100svh-11.5rem)] max-w-5xl items-center gap-12 px-5 py-12 sm:min-h-[calc(100svh-8rem)] sm:px-8 sm:py-16 lg:grid-cols-[0.88fr_1.12fr] lg:gap-16">
        <div className="relative z-10">
          <p className="mb-6 text-[11px] font-medium uppercase tracking-[0.18em] text-[#a8a29e] sm:text-[12px]">
            AI-Powered Web Explorer
          </p>

          <h1 className="max-w-xl text-[clamp(2.8rem,7vw,5.5rem)] font-bold leading-[0.94] tracking-[-0.045em]">
            正在打开
            <span className="mt-1 block text-[#d94f2b]">你的新世界</span>
          </h1>

          <p className="mt-7 max-w-md text-[14px] font-light leading-7 text-[#78716c] sm:text-[16px]">
            我们正在理解这条路径，为它找到合适的布局、色彩和互动方式。
          </p>

          <div className="mt-8 inline-flex max-w-full items-center gap-2 border-b border-[#d6cfc5] pb-2 font-mono text-[12px] text-[#78716c] sm:text-[13px]">
            <span aria-hidden="true" className="text-[#d94f2b]">/</span>
            <span className="truncate">{displayPath}</span>
          </div>

          <div
            className="mt-8 flex items-center gap-3 text-[13px] font-medium text-[#57534e]"
            aria-live="polite"
            aria-atomic="true"
          >
            <span className="relative flex h-5 w-5 items-center justify-center" aria-hidden="true">
              <span className="design-wait-pulse absolute h-5 w-5 rounded-full bg-[#d94f2b]/15" />
              <span className="relative h-1.5 w-1.5 rounded-full bg-[#d94f2b]" />
            </span>
            <span>{DESIGN_STEPS[currentStepIndex]}</span>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-[580px] lg:max-w-none" aria-hidden="true">
          <div className="absolute -left-5 -top-5 h-20 w-px bg-gradient-to-b from-transparent via-[#d6cfc5] to-transparent sm:-left-8 sm:h-28" />
          <div className="absolute -left-10 top-5 h-px w-24 bg-gradient-to-r from-transparent via-[#d6cfc5] to-transparent sm:-left-14 sm:w-32" />

          <div className="design-wait-canvas relative aspect-[1.14/1] overflow-hidden bg-[#1c1917] shadow-[0_28px_70px_rgba(28,25,23,0.22)] sm:aspect-[1.32/1]">
            <div className="flex h-10 items-center justify-between border-b border-white/10 px-4 sm:h-12 sm:px-5">
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[#d94f2b]" />
                <span className="h-1.5 w-1.5 rounded-full bg-white/20" />
                <span className="h-1.5 w-1.5 rounded-full bg-white/20" />
              </div>
              <span className="font-mono text-[9px] tracking-[0.18em] text-white/35 sm:text-[10px]">
                LIVE PREVIEW
              </span>
            </div>

            <div className="relative h-[calc(100%-2.5rem)] p-5 sm:h-[calc(100%-3rem)] sm:p-8">
              <span className="design-wait-scan absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#d94f2b] to-transparent shadow-[0_0_18px_rgba(217,79,43,0.8)]" />

              <div className="flex items-center justify-between">
                <span className="design-wait-draw h-2 w-20 origin-left bg-[#faf6f0]/85 sm:w-28" />
                <div className="flex gap-2.5">
                  <span className="design-wait-draw h-1 w-8 origin-right bg-white/20" />
                  <span className="design-wait-draw h-1 w-8 origin-right bg-white/20 [animation-delay:180ms]" />
                  <span className="design-wait-draw h-1 w-8 origin-right bg-[#d94f2b] [animation-delay:360ms]" />
                </div>
              </div>

              <div className="mt-10 grid h-[calc(100%-3.25rem)] grid-cols-[1.3fr_0.7fr] gap-4 sm:mt-14 sm:gap-6">
                <div className="flex min-w-0 flex-col">
                  <span className="design-wait-rise mb-3 h-1.5 w-14 bg-[#d94f2b]" />
                  <span className="design-wait-draw h-6 w-[90%] origin-left bg-[#faf6f0] sm:h-9" />
                  <span className="design-wait-draw mt-2 h-6 w-[68%] origin-left bg-[#faf6f0] [animation-delay:140ms] sm:h-9" />
                  <div className="mt-5 space-y-2 sm:mt-7">
                    <span className="design-wait-draw block h-1.5 w-[92%] origin-left bg-white/20 [animation-delay:220ms]" />
                    <span className="design-wait-draw block h-1.5 w-[76%] origin-left bg-white/20 [animation-delay:300ms]" />
                  </div>
                  <span className="design-wait-rise mt-auto h-8 w-24 bg-[#d94f2b] [animation-delay:420ms] sm:h-10 sm:w-32" />
                </div>

                <div className="design-wait-rise relative overflow-hidden border border-white/15 bg-white/[0.04] [animation-delay:180ms]">
                  <div className="absolute inset-3 border border-white/10 sm:inset-4" />
                  <div className="absolute bottom-3 left-3 right-3 h-[42%] bg-[#faf6f0]/90 sm:bottom-4 sm:left-4 sm:right-4" />
                  <div className="design-wait-float absolute right-[18%] top-[18%] h-8 w-8 rounded-full bg-[#d94f2b] sm:h-12 sm:w-12" />
                </div>
              </div>
            </div>
          </div>

          <div className="absolute -bottom-4 -right-3 border border-[#e7e0d6] bg-[#faf6f0] px-3 py-2 font-mono text-[9px] tracking-[0.12em] text-[#a8a29e] shadow-sm sm:-bottom-5 sm:-right-5 sm:px-4 sm:text-[10px]">
            IMAGINATION → INTERFACE
          </div>
        </div>
      </section>

      <footer className="border-t border-black/[0.06]">
        <div className="mx-auto grid max-w-5xl grid-cols-2 px-5 sm:grid-cols-4 sm:px-8">
          {DESIGN_STEPS.map((step, index) => {
            const isActive = index === currentStepIndex;
            return (
              <div
                key={step}
                className={`relative flex min-h-16 items-center gap-3 border-[#e7e0d6] py-3 pr-2 sm:min-h-[4.5rem] sm:border-r sm:px-4 sm:first:pl-0 sm:last:border-r-0 ${
                  index % 2 === 0 ? "border-r" : ""
                }`}
              >
                <span
                  className={`font-mono text-[10px] transition-colors duration-500 ${
                    isActive ? "text-[#d94f2b]" : "text-[#d6cfc5]"
                  }`}
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span
                  className={`truncate text-[11px] transition-colors duration-500 sm:text-[12px] ${
                    isActive ? "font-medium text-[#1c1917]" : "text-[#a8a29e]"
                  }`}
                >
                  {step}
                </span>
                {isActive && (
                  <span className="absolute inset-x-0 top-0 h-0.5 bg-[#d94f2b]" />
                )}
              </div>
            );
          })}
        </div>
      </footer>
    </main>
  );
}
