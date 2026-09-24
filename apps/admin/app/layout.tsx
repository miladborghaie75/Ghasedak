import type { Metadata } from "next";
import "@fontsource-variable/vazirmatn";
import "./globals.css";
import { ThemeInit } from "@/components/theme-init";

export const metadata: Metadata = {
  title: "پنل مدیریت قاصدک",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        <ThemeInit />
        {children}
      </body>
    </html>
  );
}
