"use client";

import { useCallback, useEffect, useState } from "react";
import { useAdminApi, fa } from "@/components/useAdminApi";

/**
 * صفحهٔ مدیریت سال مالی.
 *
 * چرا این صفحه وجود دارد: قبلاً تنها راه ساخت سال مالی، اجرای دستی
 * `seed.ts` بود و هیچ راهی برای بستن یا دیدن سال‌ها وجود نداشت.
 * بدون این صفحه، اگر سال باز نباشد کل سیستم مالی از کار می‌افتد.
 */

interface YearRow {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  state: "OPEN" | "LOCKED" | "CLOSED";
  entryCount: number;
  closedAt: string | null;
  reopenedAt: string | null;
}

interface OpeningLine {
  accountCode: string;
  debit: number;
  credit: number;
}

const STATE_FA: Record<string, string> = { OPEN: "باز", LOCKED: "قفل", CLOSED: "بسته" };
const STATE_CLS: Record<string, string> = {
  OPEN: "bg-primary-soft text-primary-strong",
  LOCKED: "bg-app-bg text-app-warning",
  CLOSED: "bg-app-bg text-app-muted",
};

function faDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** تاریخ امروز به فرمتی که `input[type=date]` می‌فهمد */
function todayInput(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export default function FiscalYearClient() {
  const { call, loading } = useAdminApi();
  const [items, setItems] = useState<YearRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showNew, setShowNew] = useState(false);

  // فرم سال تازه
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState(todayInput());
  const [months, setMonths] = useState("12");
  const [withOpening, setWithOpening] = useState(false);
  const [opening, setOpening] = useState<OpeningLine[]>([
    { accountCode: "1000", debit: 0, credit: 0 },
    { accountCode: "3000", debit: 0, credit: 0 },
  ]);

  const load = useCallback(async () => {
    const r = await call<{ items: YearRow[]; openId: string | null }>("/admin/accounting/fiscal-year");
    if (r.ok && r.data) {
      setItems(r.data.items);
      setOpenId(r.data.openId);
    }
  }, [call]);

  useEffect(() => {
    void load();
  }, [load]);

  const flash = (t: string, ok = true) => {
    setMsg({ t, ok });
    setTimeout(() => setMsg(null), 4000);
  };

  const openingDr = opening.reduce((s, l) => s + Number(l.debit || 0), 0);
  const openingCr = opening.reduce((s, l) => s + Number(l.credit || 0), 0);
  const openingBalanced = openingDr === openingCr && openingDr > 0;

  const create = async () => {
    if (!title.trim()) {
      flash("عنوان سال را وارد کن.", false);
      return;
    }
    setBusy(true);
    const payload: Record<string, unknown> = {
      title: title.trim(),
      startsAt: new Date(startsAt + "T00:00:00.000Z").toISOString(),
      months: Number(months) || 12,
    };
    if (withOpening && openingBalanced) {
      payload.openingLines = opening.filter((l) => l.debit !== 0 || l.credit !== 0);
    }
    const r = await call("/admin/accounting/fiscal-year", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    setBusy(false);
    if (r.ok) {
      flash("سال مالی ساخته شد و باز است.");
      setShowNew(false);
      setTitle("");
      setWithOpening(false);
      setOpening([
        { accountCode: "1000", debit: 0, credit: 0 },
        { accountCode: "3000", debit: 0, credit: 0 },
      ]);
      await load();
    } else {
      flash(r.error?.message ?? "ساخت سال ناموفق", false);
    }
  };

  const closeYear = async (y: YearRow) => {
    const n = y.entryCount;
    if (
      !window.confirm(
        `سال «${y.title}» بسته شود؟\n\n` +
          `• ${fa(n)} سند در این سال ثبت شده و بسته می‌شوند\n` +
          `• سند اختتامیه برای بستن حساب‌های درآمد و هزینه صادر می‌شود\n` +
          `• بعد از بستن، سال جدیدی ساخته نشده است — باید دستی بسازی`,
      )
    ) {
      return;
    }
    setBusy(true);
    const r = await call(`/admin/accounting/fiscal-year/${y.id}/close`, { method: "POST" });
    setBusy(false);
    if (r.ok) {
      const posted = (r.data as { closingEntryPosted?: boolean } | undefined)?.closingEntryPosted;
      flash(
        posted
          ? `سال بسته شد و سند اختتامیه صادر شد.`
          : "سال بسته شد. (این سال حساب درآمد/هزینه‌ای نداشت، پس سند اختتامیه لازم نبود.)",
      );
      await load();
    } else {
      flash(r.error?.message ?? "بستن سال ناموفق", false);
    }
  };

  const reopen = async (y: YearRow) => {
    if (!window.confirm(`سال «${y.title}» دوباره باز شود؟\n\nسندهای اختتامیهٔ قبلی حذف نمی‌شوند.`)) return;
    setBusy(true);
    const r = await call(`/admin/accounting/fiscal-year/${y.id}/reopen`, { method: "POST" });
    setBusy(false);
    if (r.ok) {
      flash("سال بازگشایی شد.");
      await load();
    } else {
      flash(r.error?.message ?? "بازگشایی ناموفق", false);
    }
  };

  return (
    <div className="space-y-4">
      {msg && (
        <p
          role="status"
          className={`rounded-xl px-3 py-2 text-xs font-bold ${msg.ok ? "bg-primary-soft text-primary-strong" : "bg-app-bg text-app-err"}`}
        >
          {msg.t}
        </p>
      )}

      {/* هشدار نبودِ سال باز */}
      {!openId && (
        <div className="rounded-card border border-app-err/40 bg-app-err/5 p-4">
          <p className="text-sm font-black text-app-err">هیچ سال مالی بازی وجود ندارد</p>
          <p className="mt-1 text-xs leading-6 text-app-muted">
            تا وقتی سال باز نباشد، هیچ سندی ثبت نمی‌شود و عملیات مالی (فروش، خرید، خزانه) رد
            می‌شود. یک سال مالی بساز تا سیستم کار کند.
          </p>
        </div>
      )}

      {/* ساخت سال تازه */}
      <section className="rounded-card border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-black text-ink">سال مالی</h2>
          <button
            onClick={() => setShowNew((s) => !s)}
            className="h-9 rounded-full bg-primary px-4 text-xs font-black text-on-accent"
          >
            {showNew ? "بستن فرم" : "+ سال مالی جدید"}
          </button>
        </div>

        {showNew && (
          <div className="mt-4 space-y-3 border-t border-line pt-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="text-[11px] font-bold text-ink/70">
                عنوان سال
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="مثلاً: ۱۴۰۵"
                  className="mt-1 w-full rounded-xl border border-line bg-app-bg px-3 py-2 text-xs"
                />
              </label>
              <label className="text-[11px] font-bold text-ink/70">
                تاریخ شروع
                <input
                  type="date"
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-line bg-app-bg px-3 py-2 text-xs"
                />
              </label>
              <label className="text-[11px] font-bold text-ink/70">
                طول سال (ماه)
                <input
                  type="number"
                  min={1}
                  max={36}
                  value={months}
                  onChange={(e) => setMonths(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-line bg-app-bg px-3 py-2 text-xs"
                />
              </label>
            </div>

            <p className="text-[11px] leading-5 text-app-muted">
              سال جاری ({openId ? "باز" : "—"}) خودکار بسته و سال تازه باز می‌شود. اسناد سال قبل
              دست‌نخورده می‌مانند.
            </p>

            {/* تراز افتتاحیه */}
            <div className="rounded-xl border border-line bg-app-bg p-3">
              <label className="flex items-center gap-2 text-xs font-bold text-ink">
                <input
                  type="checkbox"
                  checked={withOpening}
                  onChange={(e) => setWithOpening(e.target.checked)}
                  className="size-4 accent-[var(--app-primary)]"
                />
                ثبت تراز افتتاحیه (اختیاری)
              </label>

              {withOpening && (
                <div className="mt-3 space-y-2">
                  <p className="text-[11px] leading-5 text-app-muted">
                    موجودی اولیهٔ فروشگاه را همین‌جا وارد کن: موجودی صندوق و بانک در بدهکار،
                    سرمایهٔ اولیه در بستانکار.
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-ink/60">
                          <th className="p-1.5 text-right">حساب</th>
                          <th className="p-1.5">بدهکار</th>
                          <th className="p-1.5">بستانکار</th>
                          <th className="p-1.5"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {opening.map((l, i) => (
                          <tr key={i}>
                            <td className="p-1">
                              <input
                                value={l.accountCode}
                                dir="ltr"
                                onChange={(e) =>
                                  setOpening((prev) =>
                                    prev.map((x, j) => (j === i ? { ...x, accountCode: e.target.value } : x)),
                                  )
                                }
                                className="w-24 rounded-lg border border-line bg-surface px-2 py-1.5 text-[11px]"
                              />
                            </td>
                            <td className="p-1">
                              <input
                                type="number"
                                dir="ltr"
                                value={l.debit || 0}
                                onChange={(e) =>
                                  setOpening((prev) =>
                                    prev.map((x, j) =>
                                      j === i ? { ...x, debit: Number(e.target.value), credit: 0 } : x,
                                    ),
                                  )
                                }
                                className="w-28 rounded-lg border border-line bg-surface px-2 py-1.5 text-[11px]"
                              />
                            </td>
                            <td className="p-1">
                              <input
                                type="number"
                                dir="ltr"
                                value={l.credit || 0}
                                onChange={(e) =>
                                  setOpening((prev) =>
                                    prev.map((x, j) =>
                                      j === i ? { ...x, credit: Number(e.target.value), debit: 0 } : x,
                                    ),
                                  )
                                }
                                className="w-28 rounded-lg border border-line bg-surface px-2 py-1.5 text-[11px]"
                              />
                            </td>
                            <td className="p-1">
                              <button
                                onClick={() => setOpening((prev) => prev.filter((_, j) => j !== i))}
                                className="text-[11px] font-bold text-app-err"
                              >
                                ✕
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() =>
                        setOpening((prev) => [...prev, { accountCode: "1100", debit: 0, credit: 0 }])
                      }
                      className="h-8 rounded-full border border-line px-3 text-[11px] font-bold"
                    >
                      + ردیف
                    </button>
                    <span className={`text-[11px] font-bold ${openingBalanced ? "text-app-success" : "text-app-err"}`}>
                      بدهکار {fa(openingDr)} / بستانکار {fa(openingCr)}{" "}
                      {openingBalanced ? "✓ متوازن" : "— متوازن نیست"}
                    </span>
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={() => void create()}
              disabled={busy || loading || !title.trim()}
              className="h-10 w-full rounded-full bg-primary text-xs font-black text-on-accent disabled:opacity-40"
            >
              {busy ? "در حال ساخت…" : "ساخت سال مالی"}
            </button>
          </div>
        )}
      </section>

      {/* فهرست سال‌ها */}
      <section className="space-y-2">
        {items.map((y) => (
          <article
            key={y.id}
            className="rounded-card border border-line bg-surface p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-black text-ink">
                  {y.title}
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${STATE_CLS[y.state]}`}
                  >
                    {STATE_FA[y.state]}
                  </span>
                  {y.id === openId && (
                    <span className="rounded-full bg-app-success/10 px-2.5 py-0.5 text-[10px] font-bold text-app-success">
                      سال جاری
                    </span>
                  )}
                </p>
                <p className="mt-1 text-[11px] text-app-muted">
                  {faDate(y.startsAt)} تا {faDate(y.endsAt)} — {fa(y.entryCount)} سند
                </p>
                {y.closedAt && (
                  <p className="mt-0.5 text-[10px] text-app-muted">بسته شد: {faDate(y.closedAt)}</p>
                )}
                {y.reopenedAt && (
                  <p className="mt-0.5 text-[10px] text-app-muted">بازگشایی: {faDate(y.reopenedAt)}</p>
                )}
              </div>

              <div className="flex flex-wrap gap-1.5">
                {y.state === "OPEN" && y.id === openId && (
                  <button
                    onClick={() => void closeYear(y)}
                    disabled={busy}
                    className="h-9 rounded-full border border-app-err/50 px-3 text-[11px] font-bold text-app-err disabled:opacity-40"
                  >
                    بستن سال
                  </button>
                )}
                {y.state !== "OPEN" && (
                  <button
                    onClick={() => void reopen(y)}
                    disabled={busy}
                    className="h-9 rounded-full border border-line px-3 text-[11px] font-bold disabled:opacity-40"
                    title="فقط برای اصلاح اشتباه — سندهای اختتامیه حذف نمی‌شوند"
                  >
                    بازگشایی
                  </button>
                )}
              </div>
            </div>
          </article>
        ))}
        {items.length === 0 && (
          <p className="py-8 text-center text-xs text-app-muted">هنوز سال مالی‌ای تعریف نشده است.</p>
        )}
      </section>
    </div>
  );
}