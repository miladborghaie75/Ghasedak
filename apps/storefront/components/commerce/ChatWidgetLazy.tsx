"use client";

import nextDynamic from "next/dynamic";

/**
 * گام ۲۱ (کارایی) — لود تنبل ویجت چت.
 *
 * چرا wrapper جدا؟ `ssr: false` داخل Server Component ممنوع است (خطای build)؛
 * با این wrapper، چانک سنگین چت از First Load JS مشترک همهٔ صفحات خارج می‌شود
 * و دکمهٔ شناور بعد از hydration ظاهر می‌شود. HTML سروریِ قبلی هم نبود
 * (کامپوننت از قبل "use client" بود و به این خروجی تکیه داشتیم).
 */
const ChatWidget = nextDynamic(
  () => import("./ChatWidget").then((m) => ({ default: m.ChatWidget })),
  { ssr: false },
);

export function ChatWidgetLazy() {
  return <ChatWidget />;
}
