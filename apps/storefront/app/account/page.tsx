import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  addAddressAction,
  deleteAddressAction,
  logoutAction,
  saveProfileAction,
  setDefaultAddressAction,
} from "./actions";

export const dynamic = "force-dynamic";

const API = process.env.API_ORIGIN ?? "http://localhost:4000";

/**
 * «حساب من» — صفحهٔ خصوصی مشتری: سفارش‌ها، مشخصات، آدرس‌ها.
 *
 * داده سمت سرور با کوکی نشست خوانده می‌شود؛ بدون نشست ⇐ هدایت به /account/login
 * (همان رفتاری که /cart هنگام نشست منقضی دارد). جزئیات حساس (آدرس، ایمیل،
 * موبایل) هرگز به کلاینت نمی‌رود؛ این صفحه cache هم نمی‌شود.
 */
async function api<T>(path: string, cookie: string): Promise<T | null> {
  const res = await fetch(`${API}/api/v1${path}`, {
    headers: { cookie },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  return (await res.json().catch(() => null)) as T | null;
}

const faMoney = (n: number) => new Intl.NumberFormat("fa-IR").format(n);
const faDate = (iso: string) =>
  new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium" }).format(new Date(iso));

const ORDER_STATE: Record<string, { label: string; tone: string }> = {
  PENDING: { label: "در انتظار پرداخت", tone: "bg-amber-100 text-amber-800" },
  PAID: { label: "پرداخت شد", tone: "bg-primary-tint text-primary-strong" },
  PROCESSING: { label: "در حال آماده‌سازی", tone: "bg-primary-tint text-primary-strong" },
  PACKED: { label: "بسته‌بندی شد", tone: "bg-primary-tint text-primary-strong" },
  SHIPPED: { label: "ارسال شد", tone: "bg-sky-100 text-sky-800" },
  DELIVERED: { label: "تحویل شد", tone: "bg-emerald-100 text-emerald-800" },
  CANCELLED: { label: "لغو شد", tone: "bg-app-error/10 text-app-error" },
  PARTIALLY_RETURNED: { label: "بازگشت جزئی", tone: "bg-app-error/10 text-app-error" },
  REFUNDED: { label: "مسترد شد", tone: "bg-app-error/10 text-app-error" },
  FAILED: { label: "ناموفق", tone: "bg-app-error/10 text-app-error" },
};

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; address?: string }>;
}) {
  const jar = await cookies();
  const session = jar.get("ghasedak_admin_session")?.value;
  if (!session) redirect("/account/login?next=/account");
  const cookieHeader = `ghasedak_admin_session=${session}`;

  const { saved, address } = await searchParams;

  const [me, orders, addresses, provinces] = await Promise.all([
    api<{ name: string | null; email: string | null; mobile: string; ordersCount: number; addressesCount: number }>(
      "/account/me",
      cookieHeader,
    ),
    api<{
      orders: Array<{
        code: string;
        status: string;
        paymentStatus: string;
        total: number;
        createdAt: string;
        itemsCount: number;
        items: Array<{ title: string; qty: number; lineTotal: number }>;
      }>;
    }>("/account/orders", cookieHeader),
    api<{
      addresses: Array<{
        id: string;
        province: string;
        city: string;
        line: string;
        postalCode: string;
        plaque: string | null;
        unit: string | null;
        isDefault: boolean;
      }>;
    }>("/account/addresses", cookieHeader),
    api<{ items: Array<{ id: string; name: string; cities: Array<{ id: string; name: string }> }> }>("/geo/provinces", cookieHeader),
  ]);

  if (!me) redirect("/account/login?next=/account");

  const orderItems = orders?.orders ?? [];
  const addressItems = addresses?.addresses ?? [];

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold text-ink">حساب من</h1>
          <p className="mt-1 text-[13px] text-muted">
            {me.name ?? "مشتری عزیز"} — <span dir="ltr">{me.mobile}</span>
            {me.email ? <span dir="ltr"> · {me.email}</span> : null}
          </p>
        </div>
        <form action={logoutAction}>
          <button
            type="submit"
            className="h-10 rounded-full border border-line px-5 text-sm font-medium text-muted hover:border-app-error hover:text-app-error"
          >
            خروج از حساب
          </button>
        </form>
      </div>

      {/* ── سفارش‌ها ── */}
      <section className="mt-8">
        <h2 className="font-display text-base font-bold text-ink">سفارش‌های من</h2>
        {orderItems.length === 0 ? (
          <div className="mt-3 rounded-card border border-dashed border-line bg-surface p-8 text-center">
            <p className="text-sm text-muted">هنوز سفارشی ثبت نکرده‌ای.</p>
            <Link href="/" className="mt-3 inline-block rounded-full bg-primary px-6 py-2 text-sm font-bold text-on-accent hover:bg-primary-hover">
              شروع خرید
            </Link>
          </div>
        ) : (
          <ul className="mt-3 space-y-3">
            {orderItems.map((o) => {
              const st = ORDER_STATE[o.status] ?? { label: o.status, tone: "bg-app text-muted" };
              return (
                <li key={o.code} className="rounded-card border border-line bg-surface p-4">
                  <Link href={`/account/orders/${o.code}`} className="block">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-bold text-ink" dir="ltr">
                        #{o.code}
                      </div>
                      <span className={`rounded-full px-3 py-1 text-[11px] font-bold ${st.tone}`}>{st.label}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted">
                      <span>
                        {faDate(o.createdAt)} · {faMoney(o.itemsCount)} قلم
                      </span>
                      <span className="font-bold text-ink">{faMoney(o.total)} تومان</span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── مشخصات ── */}
      <section className="mt-8">
        <h2 className="font-display text-base font-bold text-ink">مشخصات</h2>
        {saved ? (
          <p role="status" className="mt-2 rounded-xl bg-primary-tint px-3 py-2 text-[13px] text-ink">
            {saved === "1" ? "ذخیره شد." : "ذخیره نشد — دوباره تلاش کن."}
          </p>
        ) : null}
        <form action={saveProfileAction} className="mt-3 rounded-card border border-line bg-surface p-4">
          <label className="block text-[13px] font-medium text-ink" htmlFor="name">
            نام
          </label>
          <input
            id="name"
            name="name"
            defaultValue={me.name ?? ""}
            className="mt-1 h-11 w-full rounded-full border border-line bg-app px-4 text-sm outline-none focus:border-primary"
          />
          <label className="mt-3 block text-[13px] font-medium text-ink" htmlFor="email">
            ایمیل
          </label>
          <input
            id="email"
            name="email"
            type="email"
            dir="ltr"
            defaultValue={me.email ?? ""}
            className="mt-1 h-11 w-full rounded-full border border-line bg-app px-4 text-sm outline-none focus:border-primary"
          />
          <button
            type="submit"
            className="mt-4 h-10 rounded-full bg-primary px-6 text-sm font-bold text-on-accent hover:bg-primary-hover"
          >
            ذخیره
          </button>
          <Link href="/account/forgot" className="ms-4 text-xs text-muted hover:underline">
            تغییر رمز
          </Link>
        </form>
      </section>

      {/* ── آدرس‌ها ── */}
      <section id="addresses" className="mt-8 scroll-mt-24">
        <h2 className="font-display text-base font-bold text-ink">آدرس‌های من</h2>
        {address ? (
          <p role="status" className="mt-2 rounded-xl bg-primary-tint px-3 py-2 text-[13px] text-ink">
            {address === "1" ? "آدرس ذخیره شد." : "آدرس ذخیره نشد — دوباره تلاش کن."}
          </p>
        ) : null}

        {addressItems.length === 0 ? (
          <p className="mt-2 text-[13px] text-muted">آدرسی ثبت نشده — فرم زیر را پر کن.</p>
        ) : (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {addressItems.map((a) => (
              <li key={a.id} className="rounded-card border border-line bg-surface p-4 text-[13px] leading-6">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-bold text-ink">
                    {a.province}، {a.city}
                  </span>
                  <div className="flex items-center gap-2">
                    {a.isDefault ? (
                      <span className="rounded-full bg-primary-tint px-2 py-0.5 text-[10px] font-bold text-primary-strong">
                        پیش‌فرض
                      </span>
                    ) : (
                      <form action={setDefaultAddressAction} className="m-0">
                        <input type="hidden" name="id" value={a.id} />
                        <button type="submit" className="rounded-full border border-line px-2 py-0.5 text-[10px] font-medium text-muted hover:bg-app hover:border-primary hover:text-primary">
                          پیش‌فرض
                        </button>
                      </form>
                    )}
                  </div>
                </div>
                <p className="mt-1 text-muted">
                  {a.line}
                  {a.plaque ? ` — پلاک ${a.plaque}` : ""}
                  {a.unit ? ` واحد ${a.unit}` : ""}
                </p>
                <p className="text-muted" dir="ltr">
                  {a.postalCode}
                </p>
                <form action={deleteAddressAction} className="mt-2">
                  <input type="hidden" name="id" value={a.id} />
                  <button type="submit" className="text-[12px] text-app-error hover:underline">
                    حذف
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}

        <form action={addAddressAction} className="mt-4 rounded-card border border-line bg-surface p-4">
          <p className="text-[13px] font-bold text-ink">افزودن آدرس</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-[13px] text-muted" htmlFor="provinceId">
                استان
              </label>
              <select
                id="provinceId"
                name="provinceId"
                required
                className="mt-1 h-11 w-full rounded-full border border-line bg-app px-4 text-sm outline-none focus:border-primary"
              >
                <option value="">—</option>
                {(provinces?.items ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[13px] text-muted" htmlFor="cityId">
                شهر
              </label>
              <select
                id="cityId"
                name="cityId"
                required
                className="mt-1 h-11 w-full rounded-full border border-line bg-app px-4 text-sm outline-none focus:border-primary"
              >
                <option value="">— ابتدا استان را انتخاب کن —</option>
                {(provinces?.items ?? []).flatMap((p) =>
                  (p.cities ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {p.name} — {c.name}
                    </option>
                  )),
                )}
              </select>
            </div>
          </div>
          <label className="mt-3 block text-[13px] text-muted" htmlFor="line">
            نشانی
          </label>
          <input
            id="line"
            name="line"
            required
            className="mt-1 h-11 w-full rounded-full border border-line bg-app px-4 text-sm outline-none focus:border-primary"
            placeholder="خیابان، کوچه، پلاک"
          />
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div>
              <label className="block text-[13px] text-muted" htmlFor="postalCode">
                کد پستی
              </label>
              <input
                id="postalCode"
                name="postalCode"
                dir="ltr"
                className="mt-1 h-11 w-full rounded-full border border-line bg-app px-4 text-sm outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-[13px] text-muted" htmlFor="plaque">
                پلاک
              </label>
              <input id="plaque" name="plaque" className="mt-1 h-11 w-full rounded-full border border-line bg-app px-4 text-sm outline-none focus:border-primary" />
            </div>
            <div>
              <label className="block text-[13px] text-muted" htmlFor="unit">
                واحد
              </label>
              <input id="unit" name="unit" className="mt-1 h-11 w-full rounded-full border border-line bg-app px-4 text-sm outline-none focus:border-primary" />
            </div>
          </div>
          <label className="mt-3 flex items-center gap-2 text-[13px] text-ink">
            <input type="checkbox" name="isDefault" className="size-4 accent-[var(--color-primary,#4f46e5)]" />
            آدرس پیش‌فرض
          </label>
          <button
            type="submit"
            className="mt-4 h-10 rounded-full bg-primary px-6 text-sm font-bold text-on-accent hover:bg-primary-hover"
          >
            ثبت آدرس
          </button>
        </form>
      </section>
    </div>
  );
}
