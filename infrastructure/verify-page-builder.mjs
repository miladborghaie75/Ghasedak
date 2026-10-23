#!/usr/bin/env node
/**
 * بررسی سازگاری صفحه‌ساز با مسیرهای واقعی سایت — بدون DB، بدون سرویس، فقط خواندنِ کد.
 *
 * چرا این اسکریپت هست؟ چند باگِ این پروژه دقیقاً از «دو فهرست که از هم افتاده‌اند»
 * درآمدند، نه از منطق خراب:
 *   ۱) `terms` و `privacy` از فهرست پیشنهادیِ پنل جا ماندند → دو صفحهٔ واقعی سایت
 *      اصلاً در صفحه‌ساز دیده نمی‌شدند؛
 *   ۲) فهرست «مسیرهای قابل‌ویرایش» با فایل‌های `app/<slug>/page.tsx` نمی‌خواند →
 *      مسیری قابل‌ویرایش اعلام می‌شد که فایلی برایش نبود (یا برعکس)؛
 *   ۳) نوع بلوکی که رندرر نداشت بی‌صدا ناپدید می‌شد.
 *
 * پس اینجا مرزها یک‌جا بررسی می‌شوند. خروجِ غیرصفر یعنی یکی از همین مرزها شکسته —
 * در CI هم اضافه شده تا دیگر بی‌صدا رد نشود.
 *
 * اجرا: `node infrastructure/verify-page-builder.mjs`
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const failures = [];
const passed = [];
const check = (name, ok, detail = "") => {
  if (ok) passed.push(name);
  else failures.push(detail ? `${name} — ${detail}` : name);
};

/* ── ۱) هر نوع بلوک باید رندرر داشته باشد (و بالعکس) ── */
const cmsSrc = read("packages/contracts/src/cms.ts");
const typesBlock = cmsSrc.match(/export const CMS_BLOCK_TYPES = \[([\s\S]*?)\] as const;/)?.[1] ?? "";
const blockTypes = [...typesBlock.matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);

const rendererSrc = read("packages/blocks/src/renderer.tsx");
const registryBlock = rendererSrc.match(/CMS_RENDERERS[^=]*=\s*\{([\s\S]*?)\n\};/)?.[1] ?? "";
const registered = [...registryBlock.matchAll(/^\s*([A-Z_]+):/gm)].map((m) => m[1]);

for (const t of blockTypes) {
  check(`بلوک ${t} رندرر دارد`, registered.includes(t), `در CMS_RENDERERS ثبت نیست`);
}
for (const r of registered) {
  check(`رندرر ${r} تعریفِ بلوک دارد`, blockTypes.includes(r), `از CMS_BLOCK_TYPES افتاده`);
}
check(
  "بلوک CONTENT_PAGE به رندرر وصل است",
  registryBlock.includes("CONTENT_PAGE: ContentPageBlock"),
);
check(
  "رندرر، عنوان صفحه را به بلوک می‌رساند (h1 صفحهٔ محتوایی)",
  rendererSrc.includes("pageTitle={page.title}"),
);

/* ── ۲) هر مسیر قابل‌ویرایش باید فایل مسیرِ فروشگاه داشته باشد و همان slug را به CmsSlot بدهد ── */
const pagesSrc = read("packages/contracts/src/site-pages.ts");
const editable = [...pagesSrc.matchAll(/path: "([^"]+)",\s*\r?\n\s*slug: "([^"]+)"/g)].map((m) => ({
  path: m[1],
  slug: m[2],
}));
check("فهرست مسیرهای قابل‌ویرایش خالی نیست", editable.length >= 6, "SITE_EDITABLE_PAGES خوانده نشد");

for (const { path, slug } of editable) {
  const file = path === "/" ? "apps/storefront/app/page.tsx" : `apps/storefront/app${path}/page.tsx`;
  const exists = existsSync(join(ROOT, file));
  check(`مسیر ${path} فایل مسیر دارد (${file})`, exists);
  if (!exists) continue;
  const src = read(file);
  const wired = path === "/" ? src.includes("HOME_SLUG") : src.includes(`slug="${slug}"`);
  check(`مسیر ${path} همان slug را به CmsSlot می‌دهد`, wired, `${file} باید slug="${slug}" داشته باشد`);
}

/* ── ۳) هر صفحهٔ محتوایی باید مسیر قابل‌ویرایش داشته باشد (و برعکس) ── */
const contentIdxSrc = read("packages/contracts/src/site-content/index.ts");
const contentBlock = contentIdxSrc.match(/SITE_CONTENT_PAGES: Record[^=]*=\s*\{([\s\S]*?)\n\};/)?.[1] ?? "";
const contentSlugs = [...contentBlock.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
const editableSlugs = editable.map((e) => e.slug);

check("فهرست محتوای مشترک خالی نیست", contentSlugs.length === 6, `${contentSlugs.length} صفحه`);
for (const slug of contentSlugs) {
  check(`صفحهٔ محتوایی /${slug} مسیر قابل‌ویرایش دارد`, editableSlugs.includes(slug));
}

/* ── ۴) فهرست پیشنهادی پنل باید از فهرست مرجع بیاید، نه لیست دستی ── */
check(
  "CMS_SUGGESTED_PAGES از SITE_EDITABLE_PAGES مشتق می‌شود",
  cmsSrc.includes("SITE_EDITABLE_PAGES.map"),
  "لیست دستی دوباره جا ماندن می‌سازد",
);

/* ── ۵) نوار پیمایشِ ContentPage دقیقاً همان شش صفحه را پوشش می‌دهد ── */
const copySrc = read("packages/contracts/src/site-copy.ts");
const navBlock = copySrc.match(/CONTENT_PAGE_NAV[^=]*=\s*\[([\s\S]*?)\];/)?.[1] ?? "";
const navSlugs = [...navBlock.matchAll(/slug: "(\w+)"/g)].map((m) => m[1]);
const same = (a, b) => [...a].sort().join(",") === [...b].sort().join(",");
check(
  "نوار پیمایش صفحه‌های محتوایی هر شش صفحه را پوشش می‌دهد",
  same(navSlugs, contentSlugs),
  `ناوبری: [${navSlugs}] / محتوا: [${contentSlugs}]`,
);

/* ── ۶) صفحه‌های مسیر باید متادیتای پویا داشته باشند (سئوی صفحه‌ساز اعمال شود) ── */
for (const slug of contentSlugs) {
  const file = `apps/storefront/app/${slug}/page.tsx`;
  if (!existsSync(join(ROOT, file))) continue;
  const src = read(file);
  check(`مسیر /${slug} متادیتای پویا دارد`, src.includes("contentPageMetadata"));
  check(`مسیر /${slug} دیگر metadata ثابت ندارد`, !src.includes("export const metadata ="));
}

/* ── ۷) چیدمان از یک کامپوننت مشترک می‌آید (پنل و سایت نمی‌توانند جدا شوند) ── */
const adapterSrc = read("apps/storefront/components/layout/SiteContentView.tsx");
check("فروشگاه از ContentPageView مشترک استفاده می‌کند", adapterSrc.includes("ContentPageView"));
check(
  "چیدمانِ قدیمی حذف شده (تک‌منبعی)",
  !existsSync(join(ROOT, "apps/storefront/components/layout/LegalShell.tsx")),
  "LegalShell برگشته — یعنی دو نسخه چیدمان داریم",
);

/* ── گزارش ── */
console.log(`✔ ${passed.length} بررسی سالم`);
if (failures.length === 0) {
  console.log("همهٔ مرزهای صفحه‌ساز با مسیرهای واقعی سایت هم‌راستاست.");
  process.exit(0);
}
console.error(`✘ ${failures.length} مرز ناهم‌راستا:`);
for (const f of failures) console.error(`  - ${f}`);
process.exit(1);
