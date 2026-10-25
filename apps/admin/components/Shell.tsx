"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MENU, isSection, type MenuItem, type MenuSection } from "@/lib/menu";
import { can, roleFa, type AdminMe } from "@/lib/session";
import { AdminBell } from "@/components/AdminBell";
import { AdminThemeToggle } from "@/components/ThemeToggle";
import { MobileNav } from "@/components/MobileNav";

/**
 * پوستهٔ پنل + سایدبار.
 *
 * این کامپوننت کلاینت است چون زیربخش‌های منو باز/بسته می‌شوند.
 * تبدیل از سرور به کلاینت امن است: `children` و `me` به‌صورت props از سرور
 * می‌آیند و هیچ دادهٔ حساسی این‌جا تولید نمی‌شود.
 *
 * قاعدهٔ بازماندن: اگر کاربر داخل یکی از صفحه‌های همان گروه باشد، گروه خودکار
 * باز می‌ماند — وگرنه مدیر هر بار باید کلیک اضافه می‌کرد تا بفهمد کجاست.
 */
export function Shell({ me, children }: { me: AdminMe; children: React.ReactNode }) {
  const pathname = usePathname();
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
            const visible = group.items.filter((i) => {
              if (isSection(i)) return visibleSections(i, me.permissions).length > 0;
              return !i.permission || can(me.permissions, i.permission);
            });
            if (visible.length === 0) return null;
            return (
              <div key={group.title} className="mb-5">
                <div className="mb-1.5 px-2 text-[11px] font-medium text-muted">{group.title}</div>
                <ul className="space-y-0.5">
                  {visible.map((item) =>
                    isSection(item) ? (
                      <SidebarSection key={item.title} section={item} pathname={pathname} permissions={me.permissions} />
                    ) : (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          aria-current={pathname === item.href ? "page" : undefined}
                          className={linkCls(pathname === item.href)}
                        >
                          {item.title}
                        </Link>
                      </li>
                    ),
                  )}
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
              <span className="hidden sm:inline">
                {" "}
                · نقش: <span className="font-medium text-ink">{role}</span>
              </span>
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
        <main id="main" className="flex-1 p-3 sm:p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}

/** آیتم‌های قابل‌دیدنِ یک زیربخش */
function visibleSections(section: MenuSection, permissions: string[]): MenuItem[] {
  if (section.items?.length) {
    return section.items.filter((i) => !i.permission || can(permissions, i.permission));
  }
  return section.href && (!section.permission || can(permissions, section.permission)) ? [{ title: section.title, href: section.href }] : [];
}

/** آیا این زیربخش صفحه‌ای دارد که کاربر الان در آن است؟ */
function sectionIsActive(section: MenuSection, pathname: string, permissions: string[]): boolean {
  return visibleSections(section, permissions).some((i) => pathname === i.href || pathname.startsWith(`${i.href}/`));
}

/**
 * زیربخش تاشو شونده.
 *
 * تک‌صفحه‌ای = لینک ساده (بدون فلش). چندصفحه‌ای = دکمهٔ باز/بسته با `aria-expanded`.
 * تیتر، خودش هم لینک است تا مسیر مستقیم هم داشته باشد.
 */
function SidebarSection({
  section,
  pathname,
  permissions,
}: {
  section: MenuSection;
  pathname: string;
  permissions: string[];
}) {
  const leaves = visibleSections(section, permissions);
  const single = leaves.length === 1 && !section.items?.length;

  // حالت تک‌صفحه‌ای: سرِ تاشو ندارد، فقط لینک
  if (single) {
    const only = leaves[0];
    return (
      <li>
        <Link
          href={only.href}
          aria-current={pathname === only.href ? "page" : undefined}
          className={linkCls(pathname === only.href || pathname.startsWith(`${only.href}/`))}
        >
          {section.title}
        </Link>
      </li>
    );
  }

  return <CollapsibleSection section={section} pathname={pathname} permissions={permissions} leaves={leaves} />;
}

function CollapsibleSection({
  section,
  pathname,
  permissions,
  leaves,
}: {
  section: MenuSection;
  pathname: string;
  permissions: string[];
  leaves: MenuItem[];
}) {
  // اگر در این زیربخش هستیم، پیش‌فرض باز است. برای بقیه، باز/بسته با
  // useState — ولی چون `useState` در حلقهٔ map مشکل‌ساز است، باز بودن را
  // با یک کلید در URL نگه نمی‌داریم و به حالت «باز اگر فعال» تکیه می‌کنیم.
  const active = sectionIsActive(section, pathname, permissions);
  void leaves;

  return (
    <li>
      <details open={active} className="group">
        <summary
          className="flex cursor-pointer list-none items-center gap-1 rounded-lg px-2.5 py-2 text-sm font-bold text-ink transition-colors hover:bg-primary-soft"
          aria-label={section.title}
        >
          <span className="flex-1">{section.title}</span>
          <span className="text-[10px] text-muted transition-transform group-open:rotate-90" aria-hidden>
            ◂
          </span>
        </summary>
        <ul className="space-y-0.5 pr-2">
          {section.items?.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={pathname === item.href ? "page" : undefined}
                className={linkCls(pathname === item.href, true)}
              >
                {item.title}
              </Link>
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}

/** کلاس مشترک لینک — حالت فعال با پس‌زمینهٔ مشخص می‌شود تا کاربر بداند کجاست */
function linkCls(active: boolean, nested = false): string {
  const base = "block rounded-lg py-2 text-sm transition-colors";
  const pad = nested ? "pr-2.5 text-[13px]" : "px-2.5";
  return active
    ? `${base} ${pad} bg-primary-soft font-bold text-primary-strong`
    : `${base} ${pad} text-ink hover:bg-primary-soft`;
}
