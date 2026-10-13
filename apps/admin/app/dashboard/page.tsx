import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { Shell } from "@/components/Shell";
import { can } from "@/lib/session";
import { getIdentity } from "@/lib/session.server";
import { api } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * داشبورد — داده کاملاً از API زنده (`GET /admin/dashboard`).
 * هیچ عدد هاردکد یا متن «نسخه نمایشی» وجود ندارد؛ نبودِ داده یعنی «—».
 */

type Dashboard = {
  generatedAt: string;
  today: {
    date: string;
    online: { count: number; total: string };
    pos: { count: number; total: string };
    total: string;
    invoiceCount: number;
  };
  openOrders: { count: number | null; unpaid: number | null; byStatus: Record<string, number> } | null;
  inventory: { value: string; skuCount: number; units: number } | null;
  checks: {
    dueCount: number;
    dueTotal: string;
    overdue: number | null;
    next: Array<{ id: string; number: string; bankName: string; amount: string; dueDate: string; direction: string; party: string }>;
  } | null;
  recentOrders: Array<{
    id: string; code: string; status: string; paymentStatus: string;
    total: string; createdAt: string; customer: string;
  }> | null;
};

async function loadDashboard(): Promise<{ data: Dashboard | null; error: string | null }> {
  const jar = await cookies();
  const cookie = jar.get("ghasedak_admin_session")?.value;
  if (!cookie) return { data: null, error: "نشست یافت نشد." };
  const res = await api<Dashboard>("/admin/dashboard", { cookie: `ghasedak_admin_session=${cookie}` });
  if (!res.ok) {
    return { data: null, error: res.error?.message ?? "دریافت اطلاعات داشبورد ممکن نشد." };
  }
  return { data: res.data ?? null, error: null };
}

export default async function OperationsDashboardPage() {
  const me = await getIdentity();
  if (!me) redirect("/login");
  if (!can(me.permissions, "dashboard.view")) {
    return (
      <Shell me={me}>
        <EmptyState message="به داشبورد دسترسی ندارید." />
      </Shell>
    );
  }

  const { data, error } = await loadDashboard();

  return (
    <Shell me={me}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2 sm:mb-6">
        <div>
          <h1 className="text-base font-black text-ink sm:text-lg">داشبورد</h1>
          <p className="mt-0.5 text-xs text-muted">
            {data ? `به‌روزرسانی: ${faDateTime(data.generatedAt)}` : "—"}
          </p>
        </div>
        <Link
          href="/reports/profit"
          className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink transition-colors hover:bg-bg"
        >
          گزارش سود
        </Link>
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-xl border border-error/40 bg-error/10 px-4 py-3 text-sm text-error">
          {error}
        </div>
      )}

      {data && (
        <>
          {/* ── فروش امروز (آنلاین + POS) ───────────────────────── */}
          <section aria-label="فروش امروز" className="mb-4">
            <div className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-xs text-muted">فروش امروز ({faDate(data.today.date)})</span>
                <span className="text-2xl font-black text-ink tnum">{faMoney(data.today.total)}</span>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Stat
                  label="فروش اینترنتی"
                  value={faMoney(data.today.online.total)}
                  hint={`${fa(data.today.online.count)} سفارش پرداخت‌شده`}
                />
                <Stat
                  label="فروش حضوری (POS)"
                  value={faMoney(data.today.pos.total)}
                  hint={`${fa(data.today.pos.count)} فاکتور`}
                />
                <Stat
                  label="تعداد اسناد"
                  value={fa(data.today.invoiceCount)}
                  hint="مجموع سفارش و فاکتور"
                />
              </dl>
            </div>
          </section>

          {/* ── کارت‌های وضعیت ──────────────────────────────────── */}
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              title="سفارش‌های باز"
              value={data.openOrders ? fa(data.openOrders.count) : null}
              hint={
                data.openOrders
                  ? `${fa(data.openOrders.unpaid ?? 0)} پرداخت‌نشده`
                  : "نیازمند مجوز سفارش‌ها"
              }
              href="/orders"
            />
            <StatCard
              title="ارزش موجودی"
              value={data.inventory ? faMoney(data.inventory.value) : null}
              hint={data.inventory ? `${fa(data.inventory.units)} عدد در ${fa(data.inventory.skuCount)} کد` : "نیازمند مجوز گزارش انبار"}
              href="/inventory/reports"
            />
            <StatCard
              title="چک‌های نزدیک"
              value={data.checks ? fa(data.checks.dueCount) : null}
              hint={
                data.checks
                  ? `${faMoney(data.checks.dueTotal)}${data.checks.overdue ? ` · ${fa(data.checks.overdue)} سررسید گذشته` : ""}`
                  : "نیازمند مجوز چک‌ها"
              }
              href="/treasury"
            />
            <StatCard
              title="موجودی کل"
              value={data.inventory ? fa(data.inventory.units) : null}
              hint="مجموع موجودی دفتر انبار"
              href="/inventory"
            />
          </div>

          {/* ── چک‌های نزدیک ───────────────────────────────────── */}
          {data.checks && data.checks.next.length > 0 && (
            <section aria-label="چک‌های نزدیک" className="mb-4 rounded-2xl border border-line bg-surface p-4 sm:p-5">
              <h2 className="mb-3 text-sm font-bold text-ink">نزدیک‌ترین سررسیدها</h2>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[34rem] text-right text-sm">
                  <thead className="text-xs text-muted">
                    <tr>
                      <th scope="col" className="py-2 font-medium">شماره چک</th>
                      <th scope="col" className="py-2 font-medium">بانک</th>
                      <th scope="col" className="py-2 font-medium">طرف</th>
                      <th scope="col" className="py-2 font-medium">سررسید</th>
                      <th scope="col" className="py-2 text-left font-medium">مبلغ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.checks.next.map((c) => {
                      const late = new Date(c.dueDate) < new Date();
                      return (
                        <tr key={c.id} className="border-t border-line">
                          <td className="py-2 font-medium text-ink" dir="ltr">{c.number}</td>
                          <td className="py-2 text-muted">{c.bankName}</td>
                          <td className="py-2 text-muted">{c.party}</td>
                          <td className={`py-2 tnum ${late ? "font-medium text-error" : "text-muted"}`}>
                            {faDate(c.dueDate)}
                            {late && " (گذشته)"}
                          </td>
                          <td className="py-2 text-left font-medium text-ink tnum">{faMoney(c.amount)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* ── آخرین سفارش‌ها ─────────────────────────────────── */}
          {data.recentOrders && data.recentOrders.length > 0 && (
            <section aria-label="آخرین سفارش‌ها" className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-ink">آخرین سفارش‌ها</h2>
                <Link href="/orders" className="text-xs text-primary-strong hover:underline">همه سفارش‌ها</Link>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[32rem] text-right text-sm">
                  <thead className="text-xs text-muted">
                    <tr>
                      <th scope="col" className="py-2 font-medium">کد</th>
                      <th scope="col" className="py-2 font-medium">مشتری</th>
                      <th scope="col" className="py-2 font-medium">وضعیت</th>
                      <th scope="col" className="py-2 font-medium">پرداخت</th>
                      <th scope="col" className="py-2 text-left font-medium">مبلغ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentOrders.map((o) => (
                      <tr key={o.id} className="border-t border-line">
                        <td className="py-2 font-medium text-ink" dir="ltr">{o.code}</td>
                        <td className="py-2 text-muted">{o.customer}</td>
                        <td className="py-2">
                          <Badge tone={statusTone(o.status)}>{statusFa(o.status)}</Badge>
                        </td>
                        <td className="py-2">
                          <Badge tone={o.paymentStatus === "PAID" ? "ok" : "muted"}>
                            {o.paymentStatus === "PAID" ? "پرداخت‌شده" : "پرداخت‌نشده"}
                          </Badge>
                        </td>
                        <td className="py-2 text-left font-medium text-ink tnum">{faMoney(o.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </Shell>
  );
}

/* ── اجزای کوچک ──────────────────────────────────────────── */

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl bg-bg p-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-bold text-ink tnum">{value}</dd>
      <p className="mt-0.5 text-[11px] text-muted">{hint}</p>
    </div>
  );
}

function StatCard({
  title, value, hint, href,
}: { title: string; value: string | null; hint: string; href: string }) {
  return (
    <Link
      href={href}
      className="group rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-primary/40"
    >
      <div className="text-xs text-muted">{title}</div>
      <div className="mt-1 text-xl font-black text-ink tnum group-hover:text-primary-strong">
        {value ?? "—"}
      </div>
      <div className="mt-1 text-[11px] text-muted">{hint}</div>
    </Link>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: "ok" | "warn" | "bad" | "muted" }) {
  const tones: Record<string, string> = {
    ok: "bg-success/12 text-success",
    warn: "bg-warning/12 text-warning",
    bad: "bg-error/12 text-error",
    muted: "bg-line/60 text-muted",
  };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-10 text-center text-sm text-muted">
      {message}
    </div>
  );
}

/* ── قالب‌بندی ─────────────────────────────────────────────── */

function fa(n: string | number | null | undefined): string {
  if (n == null) return "—";
  return Number(n).toLocaleString("fa-IR");
}

/** مبالغ به تومان و جداکننده هزارگان فارسی */
function faMoney(v: string | null | undefined): string {
  if (v == null) return "—";
  return `${fa(v)} تومان`;
}

function faDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("fa-IR", {
      timeZone: "Asia/Tehran",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "—";
  }
}

function faDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("fa-IR", {
      timeZone: "Asia/Tehran",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "—";
  }
}

const ORDER_STATUS_FA: Record<string, string> = {
  PENDING: "در انتظار",
  PAID: "پرداخت‌شده",
  PROCESSING: "در حال آماده‌سازی",
  PACKED: "بسته‌بندی‌شده",
  SHIPPED: "ارسال‌شده",
  DELIVERED: "تحویل‌شده",
  CANCELLED: "لغو‌شده",
  PARTIALLY_RETURNED: "مرجوعی جزئی",
  REFUNDED: "مسترد‌شده",
  FAILED: "ناموفق",
};

function statusFa(s: string): string {
  return ORDER_STATUS_FA[s] ?? s;
}

function statusTone(s: string): "ok" | "warn" | "bad" | "muted" {
  if (s === "DELIVERED") return "ok";
  if (s === "CANCELLED" || s === "FAILED" || s === "REFUNDED") return "bad";
  if (s === "SHIPPED" || s === "PACKED") return "warn";
  return "muted";
}
