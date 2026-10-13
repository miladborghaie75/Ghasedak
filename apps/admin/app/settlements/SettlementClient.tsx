"use client";

import { useCallback, useEffect, useState } from "react";
import { useAdminApi, fa } from "@/components/useAdminApi";

/**
 * تسویهٔ درگاه + تنظیمات هر درگاه (فاز ۲٫۵ و ۷).
 *
 * سه بخش دارد:
 *   ۱) پرداخت‌های تسویه‌نشده — پولی که هنوز نرسیده
 *   ۲) ثبت گزارش تسویه و صدور سند
 *   ۳) تنظیم کارمزد و روزهای تسویه به‌ازای هر درگاه (خواستهٔ کاربر:
 *      کارمزد از جیب فروشگاه یا خریدار، و سررسید قابل تنظیم)
 */

interface UnsettledRow {
  attemptId: string;
  orderCode: string | null;
  amount: number;
  providerId: string;
  providerName: string | null;
  verifiedAt: string | null;
  ageDays: number;
  expectedByDays: number;
  overdue: boolean;
}
interface Batch {
  id: string;
  providerId: string;
  providerName: string;
  reference: string;
  settlementDate: string;
  grossAmount: number;
  feeAmount: number;
  netAmount: number;
  status: "PENDING" | "POSTED" | "VOID";
  attemptCount: number;
  postedAt: string | null;
}
interface Gateway {
  id: string;
  name: string;
  provider: string;
  active: boolean;
  settlementDays: number | null;
  feePercentBps: number | null;
  feeFlatToman: string | null;
  feeBorneBy: string;
}
interface Summary {
  unsettledAmount: number;
  unsettledCount: number;
  overdueCount: number;
}

const faDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("fa-IR") : "—");
const STATUS_FA: Record<string, string> = { PENDING: "ثبت‌شده، سند نزده", POSTED: "تسویه و سند شد", VOID: "باطل‌شده" };

export default function SettlementClient() {
  const { call, loading } = useAdminApi();
  const [tab, setTab] = useState<"pending" | "batches" | "gateways">("pending");

  const [unsettled, setUnsettled] = useState<UnsettledRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // فرم ثبت بستهٔ تسویه
  const [form, setForm] = useState({ providerId: "", reference: "", settlementDate: "", grossAmount: "", feeAmount: "" });

  // فرم تنظیمات درگاه
  const [gwForm, setGwForm] = useState({
    id: "",
    feePercentBps: "",
    feeFlatToman: "",
    feeBorneBy: "MERCHANT",
    settlementDays: "1",
  });

  const flash = (t: string, ok = true) => {
    if (ok) setMsg(t);
    else setError(t);
    setTimeout(() => {
      setMsg(null);
      setError(null);
    }, 3500);
  };

  const loadAll = useCallback(async () => {
    const [u, s, b, g] = await Promise.all([
      call<UnsettledRow[]>("/admin/settlements/unsettled"),
      call<Summary>("/admin/settlements/summary"),
      call<{ items: Batch[] }>("/admin/settlements"),
      call<{ items: Gateway[] }>("/admin/capabilities/payment-gateway/list"),
    ]);
    if (u.ok && u.data) setUnsettled(u.data);
    if (s.ok && s.data) setSummary(s.data);
    if (b.ok && b.data) setBatches(b.data.items);
    if (g.ok && g.data) setGateways(g.data.items ?? []);
  }, [call]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const createBatch = async () => {
    setError(null);
    if (!form.providerId) return flash("درگاه را انتخاب کنید.", false);
    if (!form.reference.trim()) return flash("شمارهٔ گزارش درگاه الزامی است.", false);
    if (!form.grossAmount || Number(form.grossAmount) <= 0) return flash("مبلغ کل را وارد کنید.", false);

    setBusy(true);
    const r = await call("/admin/settlements", {
      method: "POST",
      body: JSON.stringify({
        providerId: form.providerId,
        reference: form.reference.trim(),
        settlementDate: form.settlementDate || new Date().toISOString(),
        grossAmount: Number(form.grossAmount),
        ...(form.feeAmount ? { feeAmount: Number(form.feeAmount) } : {}),
      }),
    });
    setBusy(false);
    if (r.ok) {
      flash("بستهٔ تسویه ثبت شد. حالا با «ثبت سند» پول به بانک منتقل می‌شود.");
      setForm({ providerId: "", reference: "", settlementDate: "", grossAmount: "", feeAmount: "" });
      await loadAll();
    } else {
      flash(r.error?.message ?? "ثبت ناموفق", false);
    }
  };

  const postBatch = async (id: string) => {
    if (!window.confirm("سند تسویه صادر شود؟ پول از «طلب از درگاه» به بانک منتقل و کارمزد ثبت می‌شود.")) return;
    setBusy(true);
    const r = await call<{ journalNumber?: string }>(`/admin/settlements/${id}/post`, { method: "POST" });
    setBusy(false);
    if (r.ok) {
      flash(r.data?.journalNumber ? `سند ${r.data.journalNumber} صادر شد.` : "سند صادر شد.");
      await loadAll();
    } else flash(r.error?.message ?? "ثبت سند ناموفق", false);
  };

  const saveGateway = async () => {
    if (!gwForm.id) return flash("درگاه را انتخاب کنید.", false);
    setBusy(true);
    const r = await call(`/admin/capabilities/payment-gateway/${gwForm.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        feePercentBps: gwForm.feePercentBps === "" ? null : Number(gwForm.feePercentBps),
        feeFlatToman: gwForm.feeFlatToman === "" ? null : Number(gwForm.feeFlatToman),
        feeBorneBy: gwForm.feeBorneBy,
        settlementDays: Number(gwForm.settlementDays) || 1,
      }),
    });
    setBusy(false);
    if (r.ok) {
      flash("تنظیمات درگاه ذخیره شد.");
      await loadAll();
    } else flash(r.error?.message ?? "ذخیره ناموفق", false);
  };

  const activeGw = gateways.find((g) => g.id === gwForm.id);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-card border border-app-line bg-surface p-3">
          <p className="text-[11px] font-bold text-app-muted">نزد درگاه، تسویه‌نشده</p>
          <p className="mt-1 text-base font-black tabular-nums">{fa(summary?.unsettledAmount)}</p>
          <p className="text-[10px] text-app-muted">{fa(summary?.unsettledCount)} پرداخت</p>
        </div>
        <div className="rounded-card border border-app-line bg-surface p-3">
          <p className="text-[11px] font-bold text-app-muted">بستهٔ ثبت‌شده بدون سند</p>
          <p className="mt-1 text-base font-black tabular-nums">
            {fa(batches.filter((b) => b.status === "PENDING").length)}
          </p>
        </div>
        <div className="rounded-card border border-app-line bg-surface p-3">
          <p className="text-[11px] font-bold text-app-muted">گذشته از موعد تسویه</p>
          <p className={`mt-1 text-base font-black tabular-nums ${(summary?.overdueCount ?? 0) > 0 ? "text-app-err" : ""}`}>
            {fa(summary?.overdueCount)}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap overflow-hidden rounded-xl border border-app-line">
        {(
          [
            ["pending", "تسویه‌نشده‌ها"],
            ["batches", "بسته‌های تسویه"],
            ["gateways", "تنظیمات درگاه"],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`h-9 px-4 text-[11px] font-bold ${tab === k ? "bg-primary text-on-accent" : "bg-surface text-app-muted"}`}
          >
            {l}
          </button>
        ))}
      </div>

      {msg && <p className="rounded-xl bg-app-ok/10 px-4 py-2 text-[11px] font-bold text-app-ok">{msg}</p>}
      {error && <p className="rounded-xl bg-app-err/10 px-4 py-2 text-[11px] font-bold text-app-err">{error}</p>}
      {loading && <p className="text-[11px] text-app-muted">در حال بارگذاری…</p>}

      {/* ── تسویه‌نشده‌ها ── */}
      {tab === "pending" && (
        <section className="rounded-card border border-app-line bg-surface">
          <h3 className="border-b border-app-line px-4 py-3 text-xs font-black">
            پرداخت‌های تأییدشده که هنوز تسویه نشده‌اند
          </h3>
          {unsettled.length === 0 ? (
            <p className="px-4 py-8 text-center text-[11px] text-app-muted">
              همهٔ پرداخت‌ها تسویه شده‌اند.
            </p>
          ) : (
            <div className="admin-table-wrap">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-app-line bg-ink/[0.03] text-right text-[11px] text-ink/60">
                    <th className="px-3 py-2">سفارش</th>
                    <th className="px-3 py-2">درگاه</th>
                    <th className="px-3 py-2">تاریخ تأیید</th>
                    <th className="px-3 py-2 text-end">سن</th>
                    <th className="px-3 py-2 text-end">مبلغ</th>
                  </tr>
                </thead>
                <tbody>
                  {unsettled.map((u) => (
                    <tr key={u.attemptId} className="border-b border-app-line/50">
                      <td className="px-3 py-2 font-mono text-[11px]" dir="ltr">{u.orderCode ?? "—"}</td>
                      <td className="px-3 py-2 text-[11px]">{u.providerName ?? "—"}</td>
                      <td className="px-3 py-2 text-[11px]">{faDate(u.verifiedAt)}</td>
                      <td className={`px-3 py-2 text-end text-[11px] tabular-nums ${u.overdue ? "font-bold text-app-err" : ""}`}>
                        {fa(u.ageDays)} / {fa(u.expectedByDays)} روز
                      </td>
                      <td className="px-3 py-2 text-end text-[11px] font-bold tabular-nums">{fa(u.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* ── بسته‌های تسویه ── */}
      {tab === "batches" && (
        <div className="space-y-4">
          <section className="rounded-card border border-app-line bg-surface p-4">
            <h3 className="mb-3 text-xs font-black">ثبت گزارش تسویهٔ درگاه</h3>
            <div className="grid gap-2 sm:grid-cols-5">
              <label className="text-[11px] font-bold text-ink/70">
                درگاه
                <select
                  value={form.providerId}
                  onChange={(e) => setForm({ ...form, providerId: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-app-line bg-surface px-2 py-2 text-[11px]"
                >
                  <option value="">انتخاب کنید</option>
                  {gateways.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[11px] font-bold text-ink/70">
                شمارهٔ گزارش درگاه
                <input
                  value={form.reference}
                  onChange={(e) => setForm({ ...form, reference: e.target.value })}
                  placeholder="مثلاً ST-1404-05-01"
                  dir="ltr"
                  className="mt-1 w-full rounded-xl border border-app-line bg-surface px-2 py-2 text-[11px]"
                />
              </label>
              <label className="text-[11px] font-bold text-ink/70">
                تاریخ تسویه
                <input
                  type="date"
                  value={form.settlementDate}
                  onChange={(e) => setForm({ ...form, settlementDate: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-app-line bg-surface px-2 py-2 text-[11px]"
                />
              </label>
              <label className="text-[11px] font-bold text-ink/70">
                جمع پرداخت‌ها
                <input
                  type="number"
                  value={form.grossAmount}
                  onChange={(e) => setForm({ ...form, grossAmount: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-app-line bg-surface px-2 py-2 text-[11px]"
                />
              </label>
              <label className="text-[11px] font-bold text-ink/70">
                کارمزد (خالی = خودکار)
                <input
                  type="number"
                  value={form.feeAmount}
                  onChange={(e) => setForm({ ...form, feeAmount: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-app-line bg-surface px-2 py-2 text-[11px]"
                />
              </label>
            </div>
            <p className="mt-2 text-[10px] text-app-muted">
              اگر کارمزد را خالی بگذارید، از درصد تنظیم‌شدهٔ همان درگاه حساب می‌شود. مبلغ را از
              گزارش تسویهٔ درگاه وارد کنید — نه از حدس.
            </p>
            <button
              onClick={() => void createBatch()}
              disabled={busy}
              className="mt-3 h-9 rounded-full bg-primary px-5 text-[11px] font-black text-on-accent disabled:opacity-40"
            >
              ثبت بستهٔ تسویه
            </button>
          </section>

          <section className="rounded-card border border-app-line bg-surface">
            <h3 className="border-b border-app-line px-4 py-3 text-xs font-black">بسته‌های ثبت‌شده</h3>
            {batches.length === 0 ? (
              <p className="px-4 py-8 text-center text-[11px] text-app-muted">هنوز بسته‌ای ثبت نشده است.</p>
            ) : (
              <div className="admin-table-wrap">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-app-line bg-ink/[0.03] text-right text-[11px] text-ink/60">
                      <th className="px-3 py-2">گزارش</th>
                      <th className="px-3 py-2">درگاه</th>
                      <th className="px-3 py-2">تاریخ</th>
                      <th className="px-3 py-2 text-end">کل</th>
                      <th className="px-3 py-2 text-end">کارمزد</th>
                      <th className="px-3 py-2 text-end">خالص</th>
                      <th className="px-3 py-2">وضعیت</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {batches.map((b) => (
                      <tr key={b.id} className="border-b border-app-line/50">
                        <td className="px-3 py-2 font-mono text-[11px]" dir="ltr">{b.reference}</td>
                        <td className="px-3 py-2 text-[11px]">{b.providerName}</td>
                        <td className="px-3 py-2 text-[11px]">{faDate(b.settlementDate)}</td>
                        <td className="px-3 py-2 text-end text-[11px] tabular-nums">{fa(b.grossAmount)}</td>
                        <td className="px-3 py-2 text-end text-[11px] tabular-nums">{fa(b.feeAmount)}</td>
                        <td className="px-3 py-2 text-end text-[11px] font-bold tabular-nums">{fa(b.netAmount)}</td>
                        <td className="px-3 py-2">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            b.status === "POSTED" ? "bg-app-ok/10 text-app-ok" : b.status === "VOID" ? "bg-app-line/50 text-app-muted" : "bg-app-warning/10 text-app-warning"
                          }`}>
                            {STATUS_FA[b.status]}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {b.status === "PENDING" && (
                            <button
                              onClick={() => void postBatch(b.id)}
                              disabled={busy}
                              className="rounded-full bg-primary px-3 py-1 text-[10px] font-black text-on-accent disabled:opacity-40"
                            >
                              ثبت سند
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {/* ── تنظیمات درگاه ── */}
      {tab === "gateways" && (
        <div className="space-y-4">
          <section className="rounded-card border border-app-line bg-surface p-4">
            <h3 className="mb-3 text-xs font-black">کارمزد و سررسید هر درگاه</h3>
            <div className="grid gap-2 sm:grid-cols-5">
              <label className="text-[11px] font-bold text-ink/70">
                درگاه
                <select
                  value={gwForm.id}
                  onChange={(e) => {
                    const g = gateways.find((x) => x.id === e.target.value);
                    setGwForm({
                      id: e.target.value,
                      feePercentBps: g?.feePercentBps != null ? String(g.feePercentBps) : "",
                      feeFlatToman: g?.feeFlatToman ?? "",
                      feeBorneBy: g?.feeBorneBy ?? "MERCHANT",
                      settlementDays: String(g?.settlementDays ?? 1),
                    });
                  }}
                  className="mt-1 w-full rounded-xl border border-app-line bg-surface px-2 py-2 text-[11px]"
                >
                  <option value="">انتخاب کنید</option>
                  {gateways.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[11px] font-bold text-ink/70">
                کارمزد (٪)
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={gwForm.feePercentBps}
                  onChange={(e) => setGwForm({ ...gwForm, feePercentBps: e.target.value })}
                  placeholder="۱٫۲"
                  className="mt-1 w-full rounded-xl border border-app-line bg-surface px-2 py-2 text-[11px]"
                />
              </label>
              <label className="text-[11px] font-bold text-ink/70">
                کارمزد ثابت (تومان)
                <input
                  type="number"
                  min="0"
                  value={gwForm.feeFlatToman}
                  onChange={(e) => setGwForm({ ...gwForm, feeFlatToman: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-app-line bg-surface px-2 py-2 text-[11px]"
                />
              </label>
              <label className="text-[11px] font-bold text-ink/70">
                کارمزد از جیب
                <select
                  value={gwForm.feeBorneBy}
                  onChange={(e) => setGwForm({ ...gwForm, feeBorneBy: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-app-line bg-surface px-2 py-2 text-[11px]"
                >
                  <option value="MERCHANT">فروشگاه (هزینهٔ ما)</option>
                  <option value="CUSTOMER">خریدار (روی فاکتور)</option>
                </select>
              </label>
              <label className="text-[11px] font-bold text-ink/70">
                روزهای تسویه
                <input
                  type="number"
                  min="1"
                  max="90"
                  value={gwForm.settlementDays}
                  onChange={(e) => setGwForm({ ...gwForm, settlementDays: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-app-line bg-surface px-2 py-2 text-[11px]"
                />
              </label>
            </div>
            {activeGw && (
              <p className="mt-2 text-[10px] leading-5 text-app-muted">
                «روزهای تسویه» یعنی درگاه چند روز بعد پول را می‌رساند. تا آن روز مبلغ در حساب
                «طلب از درگاه» می‌ماند و موجودی بانک بالاتر از واقعیت نشان داده نمی‌شود.
                اگر کارمزد از جیب خریدار باشد، در سند فروش کسر نمی‌شود و فقط پول خالص
                درخواست می‌شود.
              </p>
            )}
            <button
              onClick={() => void saveGateway()}
              disabled={busy}
              className="mt-3 h-9 rounded-full bg-primary px-5 text-[11px] font-black text-on-accent disabled:opacity-40"
            >
              ذخیرهٔ تنظیمات
            </button>
          </section>

          <section className="rounded-card border border-app-line bg-surface">
            <h3 className="border-b border-app-line px-4 py-3 text-xs font-black">وضعیت درگاه‌ها</h3>
            <div className="admin-table-wrap">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-app-line bg-ink/[0.03] text-right text-[11px] text-ink/60">
                    <th className="px-3 py-2">درگاه</th>
                    <th className="px-3 py-2">شناسه</th>
                    <th className="px-3 py-2 text-end">کارمزد</th>
                    <th className="px-3 py-2">جیب</th>
                    <th className="px-3 py-2 text-end">روز تسویه</th>
                    <th className="px-3 py-2">فعال</th>
                  </tr>
                </thead>
                <tbody>
                  {gateways.map((g) => (
                    <tr key={g.id} className="border-b border-app-line/50">
                      <td className="px-3 py-2 font-bold">{g.name}</td>
                      <td className="px-3 py-2 font-mono text-[10px]" dir="ltr">{g.provider}</td>
                      <td className="px-3 py-2 text-end text-[11px] tabular-nums">
                        {g.feePercentBps != null ? `${(g.feePercentBps / 100).toLocaleString("fa-IR")}٪` : "—"}
                        {g.feeFlatToman != null && Number(g.feeFlatToman) > 0 ? ` + ${fa(g.feeFlatToman)}` : ""}
                      </td>
                      <td className="px-3 py-2 text-[11px]">
                        {g.feeBorneBy === "CUSTOMER" ? "خریدار" : "فروشگاه"}
                      </td>
                      <td className="px-3 py-2 text-end text-[11px] tabular-nums">{fa(g.settlementDays)}</td>
                      <td className="px-3 py-2 text-[11px]">
                        {g.active ? <span className="font-bold text-app-ok">فعال</span> : <span className="text-app-muted">غیرفعال</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}