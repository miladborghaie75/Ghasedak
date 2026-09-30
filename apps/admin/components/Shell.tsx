import Link from "next/link";
import { MENU } from "@/lib/menu";
import { can, type AdminMe } from "@/lib/session";
import { AdminBell } from "@/components/AdminBell";
import { AdminThemeToggle } from "@/components/ThemeToggle";
import { MobileNav } from "@/components/MobileNav";

export function Shell({ me, children }: { me: AdminMe; children: React.ReactNode }) {
  const role = roleFa(me.role);
  const displayName = me.name ?? me.email ?? "—";
  return (
    <div className="flex min-h-dvh">
      {/* سایدبار ثابت — فقط دسکتاپ (lg+) */}
      <aside className="hidden w-60 shrink-0 border-l border-line bg-surface p-4 lg:block">
        <div className="mb-6">
          <div className="text-lg font-bold text-deep">قاصدک</div>
          <div className="text-xs text-muted">پنل مدیریت</div>
        </div>
        <nav aria-label="منوی مدیریت">
          {MENU.map((group) => {
            const visible = group.items.filter(
              (i) => !i.permission || can(me.permissions, i.permission),
            );
            if (visible.length === 0) return null;
            return (
              <div key={group.title} className="mb-5">
                <div className="mb-1.5 px-2 text-[11px] font-medium text-muted">{group.title}</div>
                <ul className="space-y-0.5">
                  {visible.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className="block rounded-lg px-2.5 py-2 text-sm text-ink transition-colors hover:bg-primary-soft"
                      >
                        {item.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {/* هدر — موبایل: همبرگر + لوگو + آیکن‌ها؛ دسکتاپ: اطلاعات کاربر + دکمه‌ها */}
        <header className="sticky top-0 z-40 flex h-14 items-center justify-between gap-2 border-b border-line bg-surface px-3 sm:px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <MobileNav name={displayName} roleFa={role} permissions={me.permissions} />
            <span className="min-w-0 truncate text-sm text-muted lg:block">
              {displayName}
              <span className="hidden sm:inline"> · نقش: <span className="font-medium text-ink">{role}</span></span>
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <AdminThemeToggle />
            <AdminBell />
            <a
              href="/"
              className="hidden rounded-lg border border-line px-3 py-1.5 text-sm text-ink transition-colors hover:bg-bg lg:inline-block"
            >
              ← داشبورد
            </a>
            <form action="/logout" method="post">
              <button
                type="submit"
                className="hidden rounded-lg border border-line px-3 py-1.5 text-sm text-ink transition-colors hover:bg-bg lg:inline-block"
              >
                خروج
              </button>
            </form>
          </div>
        </header>
        <main className="flex-1 p-3 sm:p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}

function roleFa(role: string): string {
  const map: Record<string, string> = {
    SUPER_ADMIN: "مدیر ارشد",
    ACCOUNTANT: "حسابدار",
    STORE_MANAGER: "مدیر فروشگاه",
    CASHIER: "صندوقدار",
    INVENTORY_MANAGER: "مدیر انبار",
    SALES_MANAGER: "مدیر فروش",
    MARKETING_MANAGER: "مدیر بازاریابی",
    SUPPORT: "پشتیبانی",
  };
  return map[role] ?? role;
}
