import type { Metadata, Viewport } from "next";
import "@fontsource-variable/vazirmatn";
import "@fontsource/lalezar";
import "./globals.css";
import { AppProviders } from "@/components/providers/AppProviders";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { QuickAddHost } from "@/components/commerce/QuickAddHost";
import { MotionReveal } from "@/components/MotionReveal";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: {
    default: `${site.fullName} | فروشگاه آنلاین لباس زیر زنانه`,
    template: `%s | ${site.name}`,
  },
  description:
    "خرید آنلاین سوتین، شورت، ست، گن، لباس ورزشی و لباس خواب با راهنمای سایز، ارسال سریع و ضمانت اصالت. ساده، مطمئن و بدون دغدغه.",
  keywords: ["لباس زیر زنانه", "سوتین", "شورت", "گن", "لباس خواب", "قاصدک"],
  openGraph: {
    title: `${site.fullName} | فروشگاه آنلاین لباس زیر زنانه`,
    description: "سوتین، شورت، ست، گن، ورزشی و لباس خواب — ساده و مطمئن خرید کنید.",
    locale: "fa_IR",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#A67DEA",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // تم از پنل ادمین (Setting theme) — بدون تغییر کد (بند ۴۰/۵۰)
  let themeCss = "";
  // موشن اسکرول — شدت/خاموشی از ادمین (Setting: motion)
  let motionAttrs = "";
  try {
    const api = process.env.API_ORIGIN ?? "http://localhost:4000";
    const r = await fetch(`${api}/api/v1/admin/public/theme`, { next: { revalidate: 60 } });
    if (r.ok) {
      const t = (await r.json()) as { primary?: string; ink?: string; bg?: string; fontHeading?: string; fontBody?: string } | null;
      if (t?.primary) {
        themeCss = `:root{--color-primary:${t.primary};--color-plum:${t.primary};--color-ink:${t.ink ?? ""};--color-bg:${t.bg ?? ""};}`
          .replace(",--color-ink:;", "").replace(",--color-bg:;", "");
      }
    }
    const rm = await fetch(`${api}/api/v1/admin/public/motion`, { next: { revalidate: 60 } });
    if (rm.ok) {
      const m = (await rm.json()) as { enabled?: boolean; intensity?: string } | null;
      motionAttrs = ` data-motion-enabled="${m?.enabled === false ? "off" : "on"}" data-motion-intensity="${m?.intensity ?? "subtle"}"`;
    }
  } catch {
    // API در دسترس نیست — تم پیش‌فرض
  }
  return (
    <html lang="fa" dir="rtl" data-motion-enabled="on" data-motion-intensity="subtle">
      <body className="min-h-dvh antialiased">
        {themeCss ? <style dangerouslySetInnerHTML={{ __html: themeCss }} /> : null}
        <AppProviders>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:start-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-plum focus:px-4 focus:py-2 focus:text-sm focus:text-white"
          >
            پرش به محتوای اصلی
          </a>
          <Header />
          <main id="main">{children}</main>
          <MotionReveal />
          <Footer />
          <QuickAddHost />
        </AppProviders>
      </body>
    </html>
  );
}
