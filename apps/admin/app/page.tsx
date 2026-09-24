import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { getIdentity, can } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const me = await getIdentity();
  if (!me) redirect("/login");
  if (!can(me.permissions, "dashboard.view")) {
    return (
      <Shell me={me}>
        <EmptyState message="به داشبورد دسترسی ندارید." />
      </Shell>
    );
  }
  return (
    <Shell me={me}>
      <h1 className="mb-1 text-xl font-bold text-deep">داشبورد</h1>
      <p className="mb-6 text-sm text-muted">
        نسخه نمایشی پنل — همه اعداد از API واقعی می‌آیند؛ فعلاً داده‌ای ثبت نشده است.
      </p>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Widget title="فروش امروز" value="—" hint="پس از ثبت اولین فروش" />
        <Widget title="سفارش‌های باز" value="—" hint="پس از اتصال ماژول سفارش" />
        <Widget title="ارزش موجودی" value="—" hint="پس از ثبت شروع موجودی" />
        <Widget title="چک‌های نزدیک" value="—" hint="پس از ثبت چک" />
      </div>
      <div className="mt-6 rounded-2xl border border-line bg-surface p-5">
        <h2 className="mb-2 font-semibold text-ink">وضعیت ماژول‌ها</h2>
        <ul className="space-y-1.5 text-sm text-muted">
          <li>✅ احراز هویت و نقش‌ها — فعال</li>
          <li>✅ محصولات — فعال</li>
          <li>✅ حسابداری (سند + تراز آزمایشی) — فعال</li>
          <li>⏳ سفارش‌ها/پرداخت‌ها/POS — فاز بعدی</li>
        </ul>
      </div>
    </Shell>
  );
}

function Widget({ title, value, hint }: { title: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="text-xs text-muted">{title}</div>
      <div className="mt-1 text-2xl font-bold text-deep">{value}</div>
      <div className="mt-1 text-[11px] text-muted">{hint}</div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-10 text-center text-sm text-muted">
      {message}
    </div>
  );
}
