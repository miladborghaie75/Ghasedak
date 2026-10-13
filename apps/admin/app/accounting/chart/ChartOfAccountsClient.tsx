"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdminApi, fa } from "@/components/useAdminApi";

/**
 * کدینگ حساب‌ها — نمایش درختی کامل با مانده.
 *
 * چرا صفحهٔ مستقل شد: قبلاً این فقط یکی از ۱۱ تب هم‌سطح بود و عملاً
 * داده‌ای هم نمی‌گرفت (در `loadTab` برای `tree` هیچ `call()`ای نبود)،
 * پس جدول همیشه خالی نشان داده می‌شد.
 *
 * این صفحه عمداً فقط **کدینگ** است؛ گزارش‌های مالی در `/accounting`
 * و اسناد در `/accounting/journal` هستند. قاطی کردنشان باعث می‌شد
 * کاربر نداند دارد کدینگ می‌بیند یا گزارش.
 */

interface TreeNode {
  id: string;
  code: string;
  name: string;
  type: string;
  level: number;
  isActive: boolean;
  balanceDr: string;
  balanceCr: string;
  children: TreeNode[];
}
interface AccountRow {
  id: string;
  code: string;
  name: string;
  type: string;
  level: number;
  parentAccountId: string | null;
  isActive: boolean;
}
interface LedgerLine {
  entryId: string;
  entryNumber: string;
  entryState: string;
  date: string;
  description: string | null;
  debit: string;
  credit: string;
}

const TYPE_FA: Record<string, string> = {
  ASSET: "دارایی",
  LIABILITY: "بدهی",
  EQUITY: "سرمایه",
  REVENUE: "درآمد",
  COGS: "بهای تمام‌شده",
  EXPENSE: "هزینه",
};

function typeFa(t: string): string {
  return TYPE_FA[t] ?? t;
}

/** گروه اصلی: ۱ دارایی · ۲ بدهی · ۳ سرمایه · ۴ درآمد · ۵ بها · ۶ هزینه */
function groupOf(code: string): string {
  const m = code.match(/^\d+/);
  return m ? m[0] : "۹";
}

export default function ChartOfAccounts() {
  const { call, loading } = useAdminApi();
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [ledger, setLedger] = useState<{
    account: { code: string; name: string; isActive: boolean };
    items: LedgerLine[];
  } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", type: "EXPENSE", parentCode: "" });

  const load = useCallback(async () => {
    const [t, a] = await Promise.all([
      call<{ items: TreeNode[] }>("/admin/accounting/accounts/tree"),
      call<{ items: AccountRow[] }>("/admin/accounting/accounts"),
    ]);
    if (t.ok && t.data) {
      setTree(t.data.items);
      // همه‌جا باز تا کاربر کدینگ را یک‌جا ببیند، نه چند کلیک عمیق
      const ids = new Set<string>();
      const walk = (nodes: TreeNode[]) => {
        for (const n of nodes) {
          ids.add(n.id);
          if (n.children.length) walk(n.children);
        }
      };
      walk(t.data.items);
      setExpanded(ids);
    } else if (t.error?.message) setError(t.error.message);
    if (a.ok && a.data) setAccounts(a.data.items);
  }, [call]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const openLedger = async (node: TreeNode) => {
    const r = await call<{ account: { code: string; name: string; isActive: boolean }; items: LedgerLine[] }>(
      `/admin/accounting/accounts/${node.id}/ledger`,
    );
    if (r.ok && r.data) setLedger(r.data);
    else setError(r.error?.message ?? "خطا در خواندن دفتر حساب");
  };

  const toggleActive = async (node: TreeNode) => {
    const r = await call(`/admin/accounting/accounts/${node.id}/active`, {
      method: "POST",
      body: JSON.stringify({ isActive: !node.isActive }),
    });
    if (r.ok) {
      setMsg(node.isActive ? `«${node.name}» غیرفعال شد` : `«${node.name}» فعال شد`);
      await load();
    } else setError(r.error?.message ?? "خطا");
  };

  const createChild = async () => {
    setError(null);
    const parent = accounts.find((a) => a.code === form.parentCode);
    if (!parent) {
      setError("حساب والد را انتخاب کنید.");
      return;
    }
    if (!/^\d{4}(-\d{2})?$/.test(form.code.trim())) {
      setError("کد باید ۴ رقم باشد (مثل ۶۰۰۰) یا کد زیرحساب (مثل ۱۱۰۰-۰۱).");
      return;
    }
    if (accounts.some((a) => a.code === form.code.trim())) {
      setError("این کد قبلاً ثبت شده است.");
      return;
    }
    setBusy(true);
    const r = await call(`/admin/accounting/accounts/${parent.id}/children`, {
      method: "POST",
      body: JSON.stringify({ code: form.code.trim(), name: form.name.trim() }),
    });
    setBusy(false);
    if (r.ok) {
      setMsg(`حساب «${form.name}» ساخته شد`);
      setForm({ code: "", name: "", type: "EXPENSE", parentCode: "" });
      setShowForm(false);
      await load();
    } else setError(r.error?.message ?? "خطا");
  };

  const counts = useMemo(() => {
    const byType: Record<string, number> = {};
    for (const a of accounts) byType[a.type] = (byType[a.type] ?? 0) + 1;
    return byType;
  }, [accounts]);

  const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
    const hasChildren = node.children.length > 0;
    const isOpen = expanded.has(node.id);
    return (
      <>
        <tr className="border-b border-line/60 last:border-0 hover:bg-ink/[0.02]">
          <td className="px-4 py-2" dir="ltr">
            <span style={{ paddingInlineStart: depth * 18 }} className="inline-flex items-center gap-1">
              {hasChildren ? (
                <button
                  onClick={() => toggle(node.id)}
                  aria-label={isOpen ? "بستن" : "باز کردن"}
                  className="text-ink/40 hover:text-ink"
                >
                  {isOpen ? "▾" : "▸"}
                </button>
              ) : (
                <span className="inline-block w-3" />
              )}
              <span className="font-mono text-xs font-bold">{node.code}</span>
            </span>
          </td>
          <td className={`px-4 py-2 ${node.isActive ? "font-bold" : "text-ink/40 line-through"}`}>
            {node.name}
            {hasChildren && <span className="ms-1 text-[10px] text-ink/40">({node.children.length})</span>}
          </td>
          <td className="px-4 py-2 text-[10px] text-ink/50">{typeFa(node.type)}</td>
          <td className="px-4 py-2 text-[10px] text-ink/40">سطح {node.level}</td>
          <td className="px-4 py-2 tabular-nums">{Number(node.balanceDr) ? fa(node.balanceDr) : "—"}</td>
          <td className="px-4 py-2 tabular-nums">{Number(node.balanceCr) ? fa(node.balanceCr) : "—"}</td>
          <td className="px-4 py-2">
            <div className="flex flex-wrap gap-1">
              <button
                onClick={() => void openLedger(node)}
                className="rounded-full border border-line px-2 py-0.5 text-[10px] font-bold text-ink/60"
              >
                دفتر
              </button>
              <button
                onClick={() => {
                  setForm({ code: "", name: "", type: node.type, parentCode: node.code });
                  setShowForm(true);
                }}
                className="rounded-full border border-line px-2 py-0.5 text-[10px] font-bold text-ink/60"
              >
                + زیرحساب
              </button>
              <button
                onClick={() => void toggleActive(node)}
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                  node.isActive
                    ? "border border-line text-ink/60"
                    : "bg-app-ok/10 text-app-ok"
                }`}
              >
                {node.isActive ? "غیرفعال" : "فعال‌سازی"}
              </button>
            </div>
          </td>
        </tr>
        {isOpen ? node.children.map((c) => renderNode(c, depth + 1)) : null}
      </>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {/* خلاصه */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "COGS", "EXPENSE"] as const).map((t) => (
          <div key={t} className="rounded-card border border-line bg-surface p-3">
            <p className="text-[11px] text-ink/60">{typeFa(t)}</p>
            <p className="mt-0.5 text-lg font-black tabular-nums">{counts[t] ?? 0}</p>
          </div>
        ))}
        <div className="rounded-card border border-line bg-surface p-3">
          <p className="text-[11px] text-ink/60">جمع حساب‌ها</p>
          <p className="mt-0.5 text-lg font-black tabular-nums">{accounts.length}</p>
        </div>
      </div>

      <p className="rounded-xl bg-app-bg px-3 py-2 text-[11px] leading-6 text-ink/70">
        کدینگ به‌صورت درختی است: کد ۴ رقمی حساب اصلی و کد <span dir="ltr">۱۱۰۰-۰۱</span>{" "}
        زیرحساب آن. هر حسابی که سند دارد، عمداً غیرفعال نمی‌شود — فقط حساب بدون گردش را
        می‌توان خاموش کرد.
      </p>

      {msg ? <p className="rounded-xl bg-app-ok/10 px-4 py-2 text-xs font-bold text-app-ok">{msg}</p> : null}
      {error ? (
        <p className="rounded-xl bg-app-err/10 px-4 py-2 text-xs font-bold text-app-err">{error}</p>
      ) : null}
      {loading ? <p className="text-xs text-ink/50">در حال بارگذاری…</p> : null}

      {/* فرم ساخت زیرحساب */}
      {showForm ? (
        <div className="flex flex-wrap items-end gap-2 rounded-card border border-primary-soft bg-surface p-4">
          <span className="text-xs font-black text-ink">زیرحساب برای «{form.parentCode}»</span>
          <label className="text-[11px] font-bold text-ink/70">
            کد
            <input
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              placeholder="۶۰۰۰-۱۰"
              dir="ltr"
              className="mt-1 w-28 rounded-xl border border-line bg-surface px-2 py-1.5 text-xs"
            />
          </label>
          <label className="text-[11px] font-bold text-ink/70">
            نام
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="هزینهٔ حمل و نقل"
              className="mt-1 w-48 rounded-xl border border-line bg-surface px-2 py-1.5 text-xs"
            />
          </label>
          <button
            onClick={() => void createChild()}
            disabled={busy || !form.code || !form.name}
            className="h-9 rounded-full bg-primary px-5 text-xs font-black text-on-accent disabled:opacity-40"
          >
            ایجاد
          </button>
          <button
            onClick={() => setShowForm(false)}
            className="h-9 rounded-full border border-line px-4 text-xs font-bold text-ink/60"
          >
            انصراف
          </button>
        </div>
      ) : null}

      {/* درخت */}
      <div className="overflow-x-auto rounded-card border border-line bg-surface">
        <div className="admin-table-wrap">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-ink/[0.03] text-right text-xs text-ink/60">
                <th className="px-4 py-3">کد</th>
                <th className="px-4 py-3">نام حساب</th>
                <th className="px-4 py-3">نوع</th>
                <th className="px-4 py-3">سطح</th>
                <th className="px-4 py-3">بدهکار</th>
                <th className="px-4 py-3">بستانکار</th>
                <th className="px-4 py-3">عملیات</th>
              </tr>
            </thead>
            <tbody>
              {tree.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-ink/50">
                    {loading ? "در حال بارگذاری…" : "حسابی تعریف نشده است."}
                  </td>
                </tr>
              ) : (
                tree.map((n) => renderNode(n, 0))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* دفتر یک حساب */}
      {ledger ? (
        <div className="rounded-card border border-line bg-surface p-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-black" dir="ltr">
              {ledger.account.code} — {ledger.account.name}
              {!ledger.account.isActive ? (
                <span className="text-[10px] text-app-err">(غیرفعال)</span>
              ) : null}
            </h4>
            <button onClick={() => setLedger(null)} className="text-xs font-bold text-ink/50">
              بستن ✕
            </button>
          </div>
          <div className="admin-table-wrap">
            <table className="mt-3 w-full text-xs">
              <thead>
                <tr className="border-b border-line text-right text-ink/60">
                  <th className="px-2 py-1">سند</th>
                  <th className="px-2 py-1">تاریخ و شرح</th>
                  <th className="px-2 py-1">بدهکار</th>
                  <th className="px-2 py-1">بستانکار</th>
                </tr>
              </thead>
              <tbody>
                {ledger.items.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-3 text-ink/50">
                      گردشی ثبت نشده است.
                    </td>
                  </tr>
                ) : (
                  ledger.items.map((l, i) => (
                    <tr key={`${l.entryId}-${i}`} className="border-b border-line/40 last:border-0">
                      <td className="px-2 py-1.5" dir="ltr">
                        {l.entryNumber}
                        {l.entryState === "DRAFT" ? (
                          <span className="text-[9px] text-app-warning"> (پیش‌نویس)</span>
                        ) : null}
                      </td>
                      <td className="px-2 py-1.5 text-ink/60">
                        {new Date(l.date).toLocaleDateString("fa-IR")} — {l.description ?? ""}
                      </td>
                      <td className="px-2 py-1.5 tabular-nums">{Number(l.debit) ? fa(l.debit) : ""}</td>
                      <td className="px-2 py-1.5 tabular-nums">{Number(l.credit) ? fa(l.credit) : ""}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <p className="text-[11px] text-ink/40">
        گروه ۱ دارایی · ۲ بدهی · ۳ سرمایه · ۴ درآمد · ۵ بهای تمام‌شده · ۶ هزینه · ۹ سایر
        {groupOf("1100") === "۱" ? "" : ""}
      </p>
    </div>
  );
}