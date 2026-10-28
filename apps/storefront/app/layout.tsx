import type { Metadata, Viewport } from "next";
import "@fontsource-variable/vazirmatn";
import "@fontsource/lalezar";
import "./globals.css";
import { AppProviders } from "@/components/providers/AppProviders";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { QuickAddHost } from "@/components/commerce/QuickAddHost";
import { ConsentGate } from "@/components/analytics/ConsentGate";
// گام ۲۱ (کارایی) — لود تنبل ویجت چت (wrapper کلاینت؛ ssr:false در RSC ممنوع است)
import { ChatWidgetLazy } from "@/components/commerce/ChatWidgetLazy";
import { ThemeInit } from "@/components/providers/theme-init";
import { MotionReveal } from "@/components/MotionReveal";
import { site, SITE_URL } from "@/lib/site";
import { hydrateCatalog, loadCatalog } from "@/lib/catalog-repo";
import { getMaintenance } from "@/lib/maintenance";
import { MaintenanceNotice } from "@/components/MaintenanceNotice";

/** لایهٔ ریشه با دادهٔ زندهٔ کاتالوگ/تم — استاتیک build نمی‌شود */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // بدون این، canonical های نسبی صفحه‌ها به localhost حل می‌شوند
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${site.fullName} | فروشگاه آنلاین لباس زیر زنانه`,
    template: `%s | ${site.name}`,
  },
  description:
    "خرید آنلاین سوتین، شورت، ست، گن، لباس ورزشی و لباس خواب با راهنمای سایز، ارسال سریع و ضمانت اصالت. ساده، مطمئن و بدون دغدغه.",
  keywords: ["لباس زیر زنانه", "سوتین", "شورت", "گن", "لباس خواب", "قاصدک"],
  openGraph: {
    title: `${site.fullName} | فروشگاه آنلاین لباس زیر زنانه`,
    description: "سوتین، شورت، ست، گن، ورزشی و لباس خواب — ساده و مطمئن خرید کن.",
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
  // کاتالوگ واقعی — یک‌بار در سرور خوانده و به کلاینت hydrate می‌شود (موج ۱)
  // گام ۲۱ (کارایی): خواندن‌های مستقل سروری هم‌زمان شروع می‌شوند — قبلاً سریالی
  // بودند و TTFB از جمع سفرها به API ساخته می‌شد. (fetch مخصوص motion حذف شد:
  // نتیجه‌اش در JSX هرگز استفاده نمی‌شد — کار مرده در هر درخواست.)
  const api = process.env.API_ORIGIN ?? "http://localhost:4000";
  const catalogP = loadCatalog();
  const themeP = fetch(`${api}/api/v1/admin/public/theme`, { next: { revalidate: 60 } }).catch(() => null);
  const maintenanceP = getMaintenance();

  const catalog = await catalogP;
  hydrateCatalog(catalog);

  // تم از پنل ادمین (Setting theme) — بدون تغییر کد (بند ۴۰/۵۰)
  let themeCss = "";
  try {
    const r = await themeP;
    if (r?.ok) {      const t = (await r.json()) as { primary?: string; ink?: string; bg?: string; fontHeading?: string; fontBody?: string } | null;
      if (t?.primary) {
        /*
         * فقط توکن‌هایی که مدین واقعاً تعیین کرده تزریق می‌شوند.
         *
         * چرا `--color-plum` تزریق نمی‌شود؟ «بنفش تیره» یک توکنِ ثابتِ برند
         * است (تیترها، بنفش تیرهٔ قاب‌ها). اگر آن را با رنگ اصلیِ مدیر یکی
         * کنیم، دو رنگِ متفاوتِ پالت به یک رنگ می‌افتند: تیترهای سایت رنگ
         * اصلی می‌گیرند و قاب «بنفش تیره» دیگر با «بنفش برند» فرقی ندارد —
         * یعنی زبان بصری برند می‌شکند.
         */
        const decls: string[] = [`--color-primary:${t.primary}`];
        if (t.ink) decls.push(`--color-ink:${t.ink}`);
        if (t.bg) decls.push(`--color-bg:${t.bg}`);
        themeCss = `:root{${decls.join(";")};}`;
      }
    }
  } catch {
    // API در دسترس نیست — تم پیش‌فرض
  }

  // حالت تعمیر (گام ۱۰): ادمین از پنل فعالش می‌کند؛ فروشگاه یک‌جا، در ریشه،
  // بسته می‌شود و به‌جای همهٔ صفحه‌ها فقط اطلاعِ تماس‌خدار نشان می‌دهد.
  const maintenance = await maintenanceP;
  if (maintenance.enabled) {
    return (
      <html lang="fa" dir="rtl" data-motion-enabled="off" data-motion-intensity="subtle" suppressHydrationWarning>
        <body className="min-h-dvh antialiased">
          {themeCss ? <style dangerouslySetInnerHTML={{ __html: themeCss }} /> : null}
          <ThemeInit />
          <MaintenanceNotice message={maintenance.message} until={maintenance.until} />
        </body>
      </html>
    );
  }
  return (
    <html lang="fa" dir="rtl" data-motion-enabled="on" data-motion-intensity="subtle" suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        {themeCss ? <style dangerouslySetInnerHTML={{ __html: themeCss }} /> : null}
        <ThemeInit />
        <AppProviders>
          {/* گام ۲۱ (کارایی) — پیش‌اتصال به دامنهٔ ثالث حیاتی (GA4 بعد از رضایت؛ React آن را به <head> می‌برد) */}
          <link rel="preconnect" href="https://www.googletagmanager.com" />
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:start-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-plum focus:px-4 focus:py-2 focus:text-sm focus:text-on-accent print:hidden"
          >
            پرش به محتوای اصلی
          </a>
          <Header />
          <main id="main">{children}</main>
          <MotionReveal />
          <Footer />
          <QuickAddHost />
          {/* گام ۱۵ — رضایت آنالیتیکس: بنر تصمیم + لود GA4 فقط پس از رضایت */}
          <ConsentGate />
          {/* گام ۱۸-۳ — دستیار خرید قاصدک (چت‌بات هوشمند؛ گام ۲۱: لود تنبل) */}
          <ChatWidgetLazy />
          {/* دادهٔ ساخت‌یافتهٔ سطح سایت (گام ۲۰): هویت فروشگاه + جست‌وجوی سایت */}
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify({
                "@context": "https://schema.org",
                "@graph": [
                  {
                    "@type": "Organization",
                    name: site.fullName,
                    url: SITE_URL,
                    logo: `${SITE_URL}/icon.svg`,
                    email: site.email,
                    telephone: site.phone,
                    sameAs: [site.instagram],
                  },
                  {
                    "@type": "WebSite",
                    name: site.name,
                    url: SITE_URL,
                    inLanguage: "fa-IR",
                    potentialAction: {
                      "@type": "SearchAction",
                      target: { "@type": "EntryPoint", urlTemplate: `${SITE_URL}/search?q={search_term_string}` },
                      "query-input": "required name=search_term_string",
                    },
                  },
                ],
              }),
            }}
          />
        </AppProviders>
      </body>
    </html>
  );
}
