import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import "./globals.css";
import Script from "next/script";

// next/font/google 会在构建时下载字体文件并自托管到项目域名下
// 运行时不依赖 Google CDN，中国大陆用户也能正常加载
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["300", "500", "700"],
  display: "swap",
  variable: "--font-display",
});

const analyticsUrl = process.env.NEXT_PUBLIC_ANALYTICS_URL;
const analyticsWebsiteId = process.env.NEXT_PUBLIC_ANALYTICS_WEBSITE_ID;

export const metadata: Metadata = {
  title: "网站任意门",
  description: "下一个页面永远是模型生成",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className={spaceGrotesk.variable}>
      <body className="antialiased">
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-8FP8487D9V"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-8FP8487D9V');
          `}
        </Script>
        {children}
        {analyticsUrl && (
          <Script defer src={analyticsUrl} data-website-id={analyticsWebsiteId} />
        )}
      </body>
    </html>
  );
}
