import Link from "next/link";
import { MENU } from "@/lib/menu";
import { can, type AdminMe } from "@/lib/session";
import { AdminBell } from "@/components/AdminBell";

export function Shell({ me, children }: { me: AdminMe; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <aside className="w-60 shrink-0 border-l border-line bg-surface p-4">
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
        <header className="flex h-14 items-center justify-between border-b border-line bg-surface px-6">
          <div className="text-sm text-muted">
            {me.name ?? me.email} · نقش: <span className="font-medium text-ink">{roleFa(me.role)}</span>
          </div>
          <div className="flex items-center gap-2">
            <AdminBell />
            <a
              href="/"
              className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink transition-colors hover:bg-bg"
            >
              ← داشبورد
            </a>
            <form action="/logout" method="post">
              <button
                type="submit"
                className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink transition-colors hover:bg-bg"
              >
                خروج
              </button>
            </form>
          </div>
        </header>
        <main className="flex-1 p-6">{children}</main>
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
