import { cookies } from "next/headers";
import PageShell from "@/components/PageShell";
import WebServiceClient from "./WebServiceClient";
import { api } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * صفحهٔ وب‌سرویس — الگوی digikala.vimascript.ir/admin/web-service:
 * آکاردئون Method/Endpoint/Header + پارامترها + نمونهٔ JSON + هدر X-API-KEY.
 * داده‌ها واقعی‌اند: اندپوینت‌های موجود در API همین پشته (بدون ادعای ساختگی)؛
 * هدر احراز X-API-KEY فقط ماسک نشان می‌دهد — بند ۴۵: مقدار کامل هرگز از API برنمی‌گردد.
 */

const BASE = "https://YOUR-DOMAIN"; // روی هاست با دامنهٔ واقعی جایگزین می‌شود؛ همهٔ مسیرها نسبی زیر /api/v1

interface ApiDoc {
  group: string;
  method: "GET" | "POST";
  endpoint: string;
  permission: string;
  desc: string;
  params: Array<{ name: string; in: string; type: string; required: boolean; desc: string }>;
  sample: unknown;
}

const GROUPS: Array<{ title: string; items: ApiDoc[] }> = [
  {
    title: "کاتالوگ عمومی (بدون احراز)",
    items: [
      {
        group: "catalog",
        method: "GET",
        endpoint: `${BASE}/api/v1/catalog/categories`,
        permission: "عمومی",
        desc: "فهرست دسته‌بندی‌های منتشرشده با شمار محصول هر دسته.",
        params: [],
        sample: {
          items: [{ id: "c1", slug: "bra", name: "سوتین", productCount: 2 }],
        },
      },
      {
        group: "catalog",
        method: "GET",
        endpoint: `${BASE}/api/v1/catalog/brands`,
        permission: "عمومی",
        desc: "فهرست برندهای منتشرشده.",
        params: [],
        sample: { items: [{ id: "b1", slug: "ghasedak", name: "قاصدک" }] },
      },
      {
        group: "catalog",
        method: "GET",
        endpoint: `${BASE}/api/v1/catalog/products`,
        permission: "عمومی",
        desc: "فهرست محصولات منتشرشدهٔ کانال وب‌سایت با قیمت مؤثر، موجودی واقعی و واریانت‌ها (رنگ/سایز).",
        params: [
          { name: "category", in: "query", type: "string", required: false, desc: "slug دسته" },
          { name: "brand", in: "query", type: "string", required: false, desc: "slug برند" },
          { name: "q", in: "query", type: "string", required: false, desc: "جست‌وجو در نام" },
          { name: "page", in: "query", type: "number", required: false, desc: "شماره صفحه (از ۱)" },
          { name: "per_page", in: "query", type: "number", required: false, desc: "اندازه صفحه — حداکثر ۱۰۰" },
        ],
        sample: {
          items: [
            {
              slug: "m14-cotton-bra",
              name: "موج ۱۴ — سوتین نخی",
              basePrice: 398000,
              inStock: true,
              variants: [{ sku: "M14-BLK-75", stock: 5, terms: [{ attribute: "color", label: "مشکی" }] }],
            },
          ],
          page: 1,
          perPage: 100,
          total: 2,
        },
      },
      {
        group: "catalog",
        method: "GET",
        endpoint: `${BASE}/api/v1/catalog/products/:slug`,
        permission: "عمومی",
        desc: "جزئیات یک محصول منتشرشده؛ برای ناموجود/غیرمنتشر ۴۰۴ با کد PRODUCT_NOT_FOUND.",
        params: [{ name: "slug", in: "path", type: "string", required: true, desc: "نامک محصول" }],
        sample: {
          slug: "m14-cotton-bra",
          name: "موج ۱۴ — سوتین نخی",
          category: { slug: "bra" },
          variants: [{ sku: "M14-BLK-80", stock: 3, price: 398000 }],
        },
      },
    ],
  },
  {
    title: "ارسال و پرداخت",
    items: [
      {
        group: "shipping",
        method: "GET",
        endpoint: `${BASE}/api/v1/shipping/methods`,
        permission: "عمومی",
        desc: "روش‌های ارسال فعال با هزینه و آستانهٔ ارسال رایگان — id واقعی برای ثبت سفارش.",
        params: [],
        sample: {
          items: [{ id: "clx…", name: "پست پیشتاز", cost: 49000, freeOverAmount: 2000000, etaDays: "۳ تا ۵ روز کاری" }],
        },
      },
      {
        group: "payments",
        method: "GET",
        endpoint: `${BASE}/api/v1/payments/methods`,
        permission: "عمومی",
        desc: "روش‌های پرداخت فعال (فقط فیلدهای عمومی).",
        params: [],
        sample: [{ id: "pm1", code: "online", namePublic: "پرداخت آنلاین" }],
      },
      {
        group: "payments",
        method: "POST",
        endpoint: `${BASE}/api/v1/payments/start`,
        permission: "عمومی (بدون احراز)",
        desc: "شروع پرداخت آنلاین — Attempt ایجاد و redirectUrl درگاه برگردانده می‌شود؛ تایید نهایی فقط با verify سمت سرور.",
        params: [
          { name: "orderId", in: "body", type: "string", required: true, desc: "شناسهٔ سفارش" },
          { name: "methodId", in: "body", type: "string", required: false, desc: "روش آنلاین فعال — در نبودش اولین روش فعال" },
          { name: "idempotencyKey", in: "body", type: "string", required: true, desc: "کلید یکتا برای جلوگیری از دوباره‌سازی" },
          { name: "callbackUrl", in: "body", type: "string", required: false, desc: "آدرس بازگشت از درگاه" },
        ],
        sample: { attemptId: "pa1", redirectUrl: "https://sandbox.zarinpal.com/StartPay/S0000…" },
      },
      {
        group: "payments",
        method: "POST",
        endpoint: `${BASE}/api/v1/payments/verify/:authority`,
        permission: "عمومی (بدون احراز)",
        desc: "تایید سمت سرور با authority درگاه — تنها مرجع تایید؛ هرگز بر اساس callback موفق نمی‌شود.",
        params: [{ name: "authority", in: "path", type: "string", required: true, desc: "شناسهٔ پرداخت درگاه" }],
        sample: { state: "PAID", refId: "123456" },
      },
    ],
  },
  {
    title: "سفارش‌ها",
    items: [
      {
        group: "orders",
        method: "POST",
        endpoint: `${BASE}/api/v1/orders`,
        permission: "عمومی (بدون احراز)",
        desc: "ثبت سفارش مهمان — رزرو موجودی، اعمال کوپن و هزینهٔ ارسال؛ idempotent با idempotencyKey.",
        params: [
          { name: "guestName", in: "body", type: "string", required: true, desc: "نام مشتری" },
          { name: "guestMobile", in: "body", type: "string", required: true, desc: "موبایل با الگوی 09xxxxxxxxx" },
          { name: "address", in: "body", type: "object", required: true, desc: "{province, city, address, plaque, unit?, postalCode}" },
          { name: "shippingMethodId", in: "body", type: "string", required: true, desc: "id از /shipping/methods" },
          { name: "lines", in: "body", type: "array", required: true, desc: "[{sku, qty}] از کاتالوگ" },
          { name: "couponCode?", in: "body", type: "string", required: false, desc: "کد تخفیف" },
          { name: "idempotencyKey?", in: "body", type: "string", required: false, desc: "کلید یکتا" },
        ],
        sample: { code: "ORD-000058", total: 447000, id: "ord1" },
      },
      {
        group: "orders",
        method: "GET",
        endpoint: `${BASE}/api/v1/orders/by-code/:code`,
        permission: "عمومی (بدون احراز)",
        desc: "یافتن سفارش با کد — برای صفحات پرداخت و پیگیری.",
        params: [{ name: "code", in: "path", type: "string", required: true, desc: "کد سفارش مثل ORD-000058" }],
        sample: { id: "ord1", code: "ORD-000058", paymentStatus: "PAID", total: 447000 },
      },
    ],
  },
  {
    title: "مدیریت (نیازمند ورود ادمین)",
    items: [
      {
        group: "payments",
        method: "GET",
        endpoint: `${BASE}/api/v1/payments/admin/list`,
        permission: "payments.view",
        desc: "لیست تلاش‌های پرداخت با فیلتر وضعیت — صفحه‌بندی ۲۰تایی.",
        params: [
          { name: "status", in: "query", type: "string", required: false, desc: "REDIRECTED | PAID | FAILED | …" },
          { name: "page", in: "query", type: "number", required: false, desc: "شماره صفحه" },
        ],
        sample: { items: [{ id: "pa1", state: "PAID", amount: 447000, order: { code: "ORD-000058" } }], total: 1, page: 1 },
      },
      {
        group: "reports",
        method: "GET",
        endpoint: `${BASE}/api/v1/admin/reports/profit`,
        permission: "accounting.reports",
        desc: "گزارش سود واقعی — فروش، بهای تمام‌شده، سود ناخالص/خالص و سود هر SKU از JournalLine (یک منبع حقیقت).",
        params: [
          { name: "from", in: "query", type: "date", required: false, desc: "شروع بازه (پیش‌فرض اول سال)" },
          { name: "to", in: "query", type: "date", required: false, desc: "پایان بازه (پیش‌فرض اکنون)" },
        ],
        sample: {
          from: "2026-01-01T00:00:00.000Z",
          revenue: "447000",
          cogs: "210000",
          grossProfit: "237000",
          expenses: "0",
          netProfit: "237000",
          perSku: [{ sku: "M14-BLK-75", qty: 1, revenue: "398000", cogs: "210000", profit: "188000" }],
        },
      },
      {
        group: "webhook",
        method: "POST",
        endpoint: `${BASE}/api/v1/payments/callback/:provider`,
        permission: "عمومی (فقط ثبت)",
        desc: "دریافت callback درگاه — فقط وضعیت ثبت می‌شود؛ هرگز به‌تنهایی تایید نیست.",
        params: [
          { name: "provider", in: "path", type: "string", required: true, desc: "مثلاً zarinpal" },
          { name: "Authority", in: "body", type: "string", required: true, desc: "شناسهٔ درگاه" },
          { name: "status", in: "body", type: "string", required: false, desc: "OK | NOK" },
        ],
        sample: { ok: true },
      },
    ],
  },
];

export default async function WebServicePage() {
  // PageShell خودش احراز می‌کند؛ اینجا فقط ماسک کلید را می‌خوانیم — مقدار کامل
  // به‌دلیل امنیتی (هویت SUPERADMIN) هرگز به کلاینت نمی‌رود (بند ۴۵/۱۱۱)
  const cookie = (await cookies()).get("ghasedak_admin_session")?.value;
  const cred = await api<{ items: Record<string, { configured: boolean; masked: string | null }> }>(
    "/admin/capabilities/credentials",
    { cookie: cookie ? `ghasedak_admin_session=${cookie}` : undefined },
  );
  const keyMasked = cred.data?.items?.GHASEDAK_API_KEY?.masked ?? null;
  const authNote =
    "اندپوینت‌های عمومی (کاتالوگ/سفارش/پرداخت) احراز نمی‌خواهند. اندپوینت‌های مدیریتی با کوکی نشست پنل احراز می‌شوند؛ برای یکپارچه‌سازی سمت سرور هدر X-API-KEY را با کلید GHASEDAK_API_KEY (فایل apps/api/.env.local، خارج از git) بفرستید — هویت معادل SUPERADMIN می‌گیرد و کلید غلط نادیده گرفته می‌شود.";
  return (
    <PageShell
      permission="settings.view"
      title="وب‌سرویس"
      subtitle="مرجع APIهای واقعی همین فروشگاه — احراز پنل با کوکی نشست؛ هدر X-API-KEY برای یکپارچه‌سازی‌های سمت سرور"
    >
      <WebServiceClient groups={GROUPS} apiKey={keyMasked} authNote={authNote} />
    </PageShell>
  );
}
