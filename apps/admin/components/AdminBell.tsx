"use client";

import { useEffect, useState } from "react";

/** زنگ ادمین — polling سبک هر ۳۰ ثانیه؛ fallback بی‌صدا (بدون فیک) */
export function AdminBell() {
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<Array<{ id: string; payload: { title?: string }; createdAt: string }>>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/admin/notifications");
        if (!res.ok) return;
        const body = (await res.json()) as { items: Array<{ id: string; payload: { title?: string }; createdAt: string }> };
        if (!alive) return;
        setItems(body.items);
        setCount(body.items.length);
      } catch { /* بی‌صدا */ }
    };
    void poll();
    const t = setInterval(poll, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="اعلان‌ها"
        className="relative rounded-lg border border-line px-2.5 py-1.5 text-sm transition-colors hover:bg-bg"
      >
        🔔
        {count > 0 && (
          <span className="absolute -end-1 -top-1 flex size-4 items-center justify-center rounded-full bg-app-primary-soft0 text-[9px] font-bold text-on-accent">
            {count > 9 ? "۹+" : count}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute end-0 top-10 z-50 w-72 rounded-card border border-line bg-surface p-2 shadow-clay-2">
          <p className="px-2 py-1 text-[11px] font-bold text-muted">۲۴ ساعت اخیر</p>
          {items.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted">اعلان جدیدی نیست.</p>
          ) : (
            items.map((n) => (
              <div key={n.id} className="rounded-lg px-2 py-1.5 text-xs text-ink hover:bg-bg">
                {n.payload?.title ?? "رویداد"}
                <span className="block text-[10px] text-muted">
                  {new Date(n.createdAt).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
