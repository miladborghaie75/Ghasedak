"use client";

import { useCallback, useEffect, useState } from "react";
import { useAdminApi, fa } from "@/components/useAdminApi";

/**
 * مرور و اصلاح اسناد حسابداری.
 *
 * این صفحه برای همان کاربری است که سندهای خودکار (مثلاً وقتی بهای خرید محصول
 * ثبت نشده بود) اشتباه می‌خوردند.
 *
 * قانونی که در UI هم رعایت شده و در سرویس هم enforce می‌شود:
 * سند قطعی (FINAL) مستقیم ویرایش نمی‌شود. برای اصلاحش اول با «برگشت به
 * پیش‌نویس» از دفاتر بیرونش می‌آوریم، ویرایشش می‌کنیم و دوباره قطعی می‌کنیم.
 * اگر مستقیم ویرایش می‌شد، تاریخچهٔ دفاتر بازنویسی می‌شد و معلوم نمی‌شد
 * اشتباه کجا بوده — برای همین دکمهٔ ویرایش روی سند قطعی غیرفعال است.
 */

interface EntryLine {
  id?: string;
  accountCode: string;
  accountName?: string;
  debit: number;
  credit: number;
}
interface EntryRow {
  id: string;
  number: string;
  date: string;
  description: string;
  sourceType: string;
  state: "DRAFT" | "FINAL";
  totalDebit: number;
  lines: EntryLine[];
}
interface AccountRow {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

export default function JournalEditor() {
  const { call, loading } = useAdminApi();
  const [items, setItems] = useState<EntryRow[]>([]);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [stateFilter, setStateFilter] = useState<"" | "DRAFT" | "FINAL">("");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<EntryRow | null>(null);
  const [draft, setDraft] = useState<EntryLine[]>([]);
  const [desc, setDesc] = useState("");
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const flash = (t: string, ok = true) => {
    setMsg({ t, ok });
    setTimeout(() => setMsg(null), 3500);
  };

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ limit: "50" });
    if (stateFilter) qs.set("state", stateFilter);
    if (q.trim()) qs.set("q", q.trim());
    const r = await call<{ items: EntryRow[]; total: number }>(`/admin/accounting/journal?${qs}`);
    if (r.ok && r.data) setItems(r.data.items);
  }, [call, stateFilter, q]);

  useEffect(() => {
    void load();
    void (async () => {
      const r = await call<{ items: AccountRow[] }>("/admin/accounting/accounts");
      if (r.ok && r.data) setAccounts(r.data.items.filter((a) => a.isActive));
    })();
  }, [load, call]);

  const openEdit = (e: EntryRow) => {
    setEditing(e);
    setDesc(e.description);
    setDraft(e.lines.map((l) => ({ accountCode: l.accountCode, debit: l.debit, credit: l.credit })));
  };

  const setLine = (i: number, patch: Partial<EntryLine>) =>
    setDraft((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const totals = draft.reduce(
    (acc, l) => ({ dr: acc.dr + Number(l.debit || 0), cr: acc.cr + Number(l.credit || 0) }),
    { dr: 0, cr: 0 },
  );
  const balanced = totals.dr === totals.cr && totals.dr > 0;

  const save = async () => {
    if (!editing) return;
    if (!balanced) {
      flash("سند باید متوازن باشد و حداقل دو ردیف داشته باشد.", false);
      return;
    }
    setBusy(true);
    const r = await call(`/admin/accounting/journal/${editing.id}`, {
      method: "PUT",
      body: JSON.stringify({
        description: desc,
        lines: draft.map((l) => ({
          accountCode: l.accountCode,
          debit: Number(l.debit || 0),
          credit: Number(l.credit || 0),
        })),
      }),
    });
    setBusy(false);
    if (r.ok) {
      flash("سند اصلاح شد");
      setEditing(null);
      await load();
    } else {
      flash(r.error?.message ?? "ذخیره ناموفق", false);
    }
  };

  const revert = async (e: EntryRow) => {
    if (!window.confirm(`سند ${e.number} به پیش‌نویس برگردد؟ تا وقتی دوباره قطعی نشود، از دفاتر بیرون می‌ماند.`)) return;
    const r = await call(`/admin/accounting/journal/${e.id}/revert`, { method: "POST" });
    if (r.ok) {
      flash("سند به پیش‌نویس برگشت و از دفاتر خارج شد");
      await load();
    } else flash(r.error?.message ?? "ناموفق", false);
  };

  const finalize = async (e: EntryRow) => {
    const r = await call(`/admin/accounting/journal/${e.id}/finalize`, { method: "POST" });
    if (r.ok) {
      flash("سند قطعی شد و در دفاتر نشست");
      await load();
    } else flash(r.error?.message ?? "ناموفق", false);
  };

  const remove = async (e: EntryRow) => {
    if (!window.confirm(`سند ${e.number} حذف شود؟`)) return;
    const r = await call(`/admin/accounting/journal/${e.id}`, { method: "DELETE" });
    if (r.ok) {
      flash("سند حذف شد");
      await load();
    } else flash(r.error?.message ?? "ناموفق", false);
  };

  return (
    <div className="space-y-4">
      {msg && (
        <p role="status" className={`rounded-xl px-3 py-2 text-xs font-bold ${msg.ok ? "bg-primary-soft text-primary-strong" : "bg-app-bg text-app-err"}`}>
          {msg.t}
        </p>
      )}

      {/* فیلتر */}
      <div className="flex flex-wrap gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="جست‌وجو در شماره یا شرح سند…"
          className="h-9 flex-1 rounded-xl border border-line bg-app-bg px-3 text-xs"
        />
        {(["", "DRAFT", "FINAL"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStateFilter(s)}
            className={`h-9 rounded-xl border px-3 text-[11px] font-bold ${
              stateFilter === s ? "border-primary bg-primary text-on-accent" : "border-line bg-app-bg text-ink/70"
            }`}
          >
            {s === "" ? "همه" : s === "DRAFT" ? "پیش‌نویس" : "قطعی"}
          </button>
        ))}
        <button onClick={() => void load()} className="h-9 rounded-xl border border-line px-3 text-[11px] font-bold">
          تازه‌سازی
        </button>
      </div>

      {/* فرم ویرایش */}
      {editing && (
        <section className="rounded-card border border-primary-soft bg-app-bg p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-black text-ink">
              اصلاح سند <span dir="ltr">{editing.number}</span>
            </h3>
            <button onClick={() => setEditing(null)} className="h-8 rounded-xl border border-line px-3 text-[11px] font-bold">
              بستن
            </button>
          </div>

          <label className="mt-3 block text-[11px] font-bold text-ink/60">شرح سند</label>
          <input
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-xs"
          />

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-line text-ink/60">
                  <th className="p-2 text-right">حساب</th>
                  <th className="p-2">بدهکار</th>
                  <th className="p-2">بستانکار</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {draft.map((l, i) => (
                  <tr key={i} className="border-b border-line/40">
                    <td className="p-1">
                      <select
                        value={l.accountCode}
                        onChange={(e) => setLine(i, { accountCode: e.target.value })}
                        className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-[11px]"
                      >
                        {accounts.map((a) => (
                          <option key={a.id} value={a.code}>
                            {a.code} — {a.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-1">
                      <input
                        type="number"
                        dir="ltr"
                        value={l.debit || 0}
                        onChange={(e) => setLine(i, { debit: Number(e.target.value), credit: 0 })}
                        className="w-24 rounded-lg border border-line bg-surface px-2 py-1.5 text-[11px]"
                      />
                    </td>
                    <td className="p-1">
                      <input
                        type="number"
                        dir="ltr"
                        value={l.credit || 0}
                        onChange={(e) => setLine(i, { credit: Number(e.target.value), debit: 0 })}
                        className="w-24 rounded-lg border border-line bg-surface px-2 py-1.5 text-[11px]"
                      />
                    </td>
                    <td className="p-1 text-center">
                      <button
                        onClick={() => setDraft((prev) => prev.filter((_, j) => j !== i))}
                        className="text-[11px] font-bold text-app-err"
                      >
                        حذف
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              onClick={() => setDraft((prev) => [...prev, { accountCode: accounts[0]?.code ?? "1200", debit: 0, credit: 0 }])}
              className="h-8 rounded-full border border-line px-3 text-[11px] font-bold"
            >
              + ردیف
            </button>
            <span className={`text-[11px] font-bold ${balanced ? "text-app-success" : "text-app-err"}`}>
              بدهکار {fa(totals.dr)} / بستانکار {fa(totals.cr)} {balanced ? "✓ متوازن" : "— متوازن نیست"}
            </span>
            <button
              onClick={() => void save()}
              disabled={busy || loading || !balanced}
              className="h-9 rounded-full bg-primary px-5 text-xs font-black text-on-accent disabled:opacity-40"
            >
              ذخیرهٔ اصلاح
            </button>
          </div>
        </section>
      )}

      {/* فهرست */}
      <div className="space-y-2">
        {items.map((e) => (
          <article key={e.id} className="rounded-card border border-line bg-surface p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-xs font-black text-ink">
                  <span dir="ltr">{e.number}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      e.state === "FINAL" ? "bg-primary-soft text-primary-strong" : "bg-app-bg text-ink/60"
                    }`}
                  >
                    {e.state === "FINAL" ? "قطعی" : "پیش‌نویس"}
                  </span>
                  {e.sourceType && (
                    <span className="rounded-full bg-app-bg px-2 py-0.5 text-[10px] text-ink/50">
                      {e.sourceType}
                    </span>
                  )}
                </p>
                <p className="mt-1 truncate text-[12px] text-ink/80">{e.description}</p>
                <p className="mt-0.5 text-[10px] text-ink/50">
                  {e.lines.map((l) => l.accountCode).join(" · ")} — جمع {fa(e.totalDebit)}
                </p>
              </div>

              <div className="flex flex-wrap gap-1">
                {e.state === "DRAFT" ? (
                  <>
                    <button onClick={() => openEdit(e)} className="h-8 rounded-full bg-primary px-3 text-[11px] font-black text-on-accent">
                      ویرایش
                    </button>
                    <button onClick={() => void finalize(e)} className="h-8 rounded-full border border-line px-3 text-[11px] font-bold">
                      قطعی کن
                    </button>
                    <button onClick={() => void remove(e)} className="h-8 rounded-full border border-line px-3 text-[11px] font-bold text-app-err">
                      حذف
                    </button>
                  </>
                ) : (
                  <>
                    {/* سند قطعی مستقیم ویرایش نمی‌شود — اول باید برگردد */}
                    <button
                      onClick={() => void revert(e)}
                      className="h-8 rounded-full border border-primary-soft px-3 text-[11px] font-bold text-primary-strong"
                      title="بازگشت به پیش‌نویس برای اصلاح"
                    >
                      برگشت به پیش‌نویس
                    </button>
                    <button disabled className="h-8 rounded-full border border-line px-3 text-[11px] font-bold opacity-40" title="سند قطعی مستقیم ویرایش نمی‌شود">
                      ویرایش
                    </button>
                  </>
                )}
                {/* چاپ و پیوست مدارک — برای هر دو وضعیت پیش‌نویس و قطعی */}
                <a
                  href={`/accounting/journal/print/${e.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="h-8 rounded-full border border-line px-3 text-[11px] font-bold"
                  title="چاپ سند و پیوست فایل"
                >
                  چاپ / پیوست
                </a>
              </div>
            </div>
          </article>
        ))}
        {items.length === 0 && <p className="py-6 text-center text-xs text-ink/50">سندی با این فیلتر نیست.</p>}
      </div>
    </div>
  );
}