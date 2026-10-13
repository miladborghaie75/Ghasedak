"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MENU, isSection, type MenuItem, type MenuSection } from "@/lib/menu";

/**
 * ناوبری موبایل — فاز ۱۴ ریسپانسیو کردن پنل.
 * سایدبار ثابت دسکتاپ (lg+) سروری است؛ زیر lg این درایور کلاینت همان منو را
 * به‌صورت کشوی کشویی از راست نشان می‌دهد (الگوی نمونه: همبرگر ☰ در هدر).
 */
export function MobileNav({
  name,
  roleFa,
  permissions,
}: {
  name: string;
  roleFa: string;
  permissions: string[];
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // با هر ناوبری، کشو بسته شود
  useEffect(() => { setOpen(false); }, [pathname]);

  // Escape کشو را می‌بندد؛ بدنه در حالت باز قفل اسکرول می‌شود
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const visible = MENU.map((g) => ({
    title: g.title,
    items: g.items.filter((i) => {
      if (isSection(i)) return sectionLeaves(i, permissions).length > 0;
      return !i.permission || permissions.includes(i.permission);
    }),
  })).filter((g) => g.items.length > 0);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="باز کردن منو"
        aria-expanded={open}
        className="flex size-9 items-center justify-center rounded-lg border border-line text-ink transition-colors hover:bg-bg lg:hidden"
      >
        <span aria-hidden className="text-lg leading-none">☰</span>
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 end-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto border-s border-line bg-surface p-4 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-lg font-bold text-deep">قاصدک</div>
                <div className="text-xs text-muted">پنل مدیریت</div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="بستن منو"
                className="flex size-8 items-center justify-center rounded-lg border border-line text-ink/60 hover:text-ink"
              >
                ✕
              </button>
            </div>

            {/* کارت کاربر — الگوی نمونه */}
            <div className="mb-4 flex items-center gap-3 rounded-card border border-line bg-bg p-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-black text-primary-strong">
                {(name ?? "?").trim().charAt(0) || "؟"}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold text-ink">{name ?? "—"}</span>
                <span className="block text-xs text-muted">{roleFa}</span>
              </span>
            </div>

            <nav aria-label="منوی مدیریت موبایل" className="flex-1">
              {visible.map((group) => (
                <div key={group.title} className="mb-4">
                  <div className="mb-1.5 px-2 text-[11px] font-medium text-muted">{group.title}</div>
                  <ul className="space-y-0.5">
                    {group.items.map((item) =>
                      isSection(item) ? (
                        <MobileSection
                          key={item.title}
                          section={item}
                          pathname={pathname}
                          permissions={permissions}
                        />
                      ) : (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            className={`block rounded-lg px-2.5 py-2 text-sm transition-colors ${
                              pathname === item.href
                                ? "bg-primary-soft font-bold text-primary-strong"
                                : "text-ink hover:bg-primary-soft"
                            }`}
                          >
                            {item.title}
                          </Link>
                        </li>
                      ),
                    )}
                  </ul>
                </div>
              ))}
            </nav>

            <div className="mt-2 space-y-2 border-t border-line pt-3">
              <Link
                href="/"
                className="block rounded-lg border border-line px-3 py-2 text-center text-sm text-ink"
              >
                ← داشبورد
              </Link>
              <form action="/logout" method="post">
                <button
                  type="submit"
                  className="h-9 w-full rounded-lg border border-app-err/40 text-sm font-bold text-app-err"
                >
                  خروج
                </button>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** آیتم‌های قابل‌دیدن یک زیربخش */
function sectionLeaves(section: MenuSection, permissions: string[]): MenuItem[] {
  if (section.items?.length) {
    return section.items.filter((i) => !i.permission || permissions.includes(i.permission));
  }
  return section.href && (!section.permission || permissions.includes(section.permission))
    ? [{ title: section.title, href: section.href }]
    : [];
}

/**
 * زیربخش در موبایل — تک‌صفحه‌ای لینک ساده، چندصفحه‌ای تاشو.
 * همان قاعدهٔ دسکتاپ، چون دو سایدبار باید رفتار یکسان داشته باشند.
 */
function MobileSection({
  section,
  pathname,
  permissions,
}: {
  section: MenuSection;
  pathname: string;
  permissions: string[];
}) {
  const leaves = sectionLeaves(section, permissions);
  if (leaves.length === 1 && !section.items?.length) {
    const only = leaves[0];
    const active = pathname === only.href || pathname.startsWith(`${only.href}/`);
    return (
      <li>
        <Link
          href={only.href}
          className={`block rounded-lg px-2.5 py-2 text-sm transition-colors ${
            active ? "bg-primary-soft font-bold text-primary-strong" : "text-ink hover:bg-primary-soft"
          }`}
        >
          {section.title}
        </Link>
      </li>
    );
  }

  const active = leaves.some((l) => pathname === l.href || pathname.startsWith(`${l.href}/`));

  return (
    <li>
      <details open={active} className="group">
        <summary className="flex cursor-pointer list-none items-center gap-1 rounded-lg px-2.5 py-2 text-sm font-bold text-ink hover:bg-primary-soft">
          <span className="flex-1">{section.title}</span>
          <span className="text-[10px] text-muted transition-transform group-open:rotate-90" aria-hidden>
            ◂
          </span>
        </summary>
        <ul className="space-y-0.5 pr-2">
          {section.items?.map((i) => (
            <li key={i.href}>
              <Link
                href={i.href}
                className={`block rounded-lg py-2 pe-2.5 text-[13px] transition-colors ${
                  pathname === i.href ? "bg-primary-soft font-bold text-primary-strong" : "text-ink hover:bg-primary-soft"
                }`}
              >
                {i.title}
              </Link>
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}
