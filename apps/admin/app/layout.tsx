import type { Metadata, Viewport } from "next";
import "@fontsource-variable/vazirmatn";
import "./globals.css";
import { ThemeInit } from "@/components/theme-init";

export const metadata: Metadata = {
  title: "پنل مدیریت قاصدک",
  robots: { index: false, follow: false },
};

/** فاز ۱۴ — ریسپانسیو پنل: ویوپورت صحیح موبایل + منع زوم دوبل-تپ فرم‌ها */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <body className="min-h-dvh overflow-x-hidden antialiased" suppressHydrationWarning>
        <ThemeInit />
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:start-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-app-primary focus:px-4 focus:py-2 focus:text-sm focus:text-app-on-accent"
        >
          پرش به محتوای اصلی
        </a>
        {children}
      </body>
    </html>
  );
}
