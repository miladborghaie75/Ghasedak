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
      <body className="min-h-dvh overflow-x-hidden antialiased">
        <ThemeInit />
        {children}
      </body>
    </html>
  );
}
