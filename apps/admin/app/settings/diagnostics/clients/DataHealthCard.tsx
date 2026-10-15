"use client";

import { useCallback, useEffect, useState } from "react";
import { useAdminApi, fa } from "@/components/useAdminApi";

interface Finding {
  entity: "Product" | "Category" | "Brand";
  id: string;
  field: "name" | "shortDescription" | "description" | "slug";
  reason: "REPLACEMENT_CHAR" | "CONTROL_CHAR" | "INVALID_SLUG";
  label: string;
  value: string | null;
  status: string;
  repairable: boolean;
}
interface Report {
  checkedAt: string;
  tookMs: number;
  dirtyCount: number;
  affectedRows: number;
  repairableRows: number;
  findings: Finding[];
}
interface Outcome {
  entity: string;
  id: string;
  action: "REPAIRED" | "SKIPPED";
  reason?: string;
  nameBefore: string;
  nameAfter: string;
  slugBefore: string;
  slugAfter: string;
  statusBefore: string;
  statusAfter: string;
  clearedFields: string[];
}
interface RepairResult {
  rowsSeen: number;
  repaired: number;
  skipped: number;
  outcomes: Outcome[];
  reportAfter: Report;
}

const entityLabel: Record<Finding["entity"], string> = { Product: "محصول", Category: "دسته", Brand: "برند" };
const fieldLabel: Record<Finding["field"], string> = {
  name: "نام",
  shortDescription: "توضیح کوتاه",
  description: "توضیح",
  slug: "اسلاگ",
};
const reasonLabel: Record<Finding["reason"], string> = {
  REPLACEMENT_CHAR: "کاراکتر نامعتبر (U+FFFD)",
  CONTROL_CHAR: "کاراکتر کنترلی",
  INVALID_SLUG: "اسلاگ نامعتبر",
};

/**
 * گام F0-3 — کارت «کیفیت داده» در مرکز عیب‌یابی.
 * اسکن فقط-خواندنی + اکشن اصلاح (نام از شواهد SKU، آرشیو ردیف، پاک‌سازی
 * توضیح خراب، AuditLog per-row). دکمهٔ اصلاح فقط با مجوز settings.manage.
 */
export default function DataHealthCard() {
  const { call, loading, permissions } = useAdminApi();
  const [report, setReport] = useState<Report | null>(null);
  const [result, setResult] = useState<RepairResult | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const canRepair = permissions.includes("settings.manage");

  const scan = useCallback(async () => {
    setErr("");
    const r = await call<Report>("/admin/data-health");
    if (r.ok && r.data) setReport(r.data);
    else setErr(r.error?.message ?? "خطا در اسکن کیفیت داده");
  }, [call]);
  useEffect(() => { void scan(); }, [scan]);

  const repair = async () => {
    setMsg("");
    setErr("");
    const r = await call<RepairResult>("/admin/data-health/repair", { method: "POST", body: JSON.stringify({}) });
    if (r.ok && r.data) {
      setResult(r.data);
      setReport(r.data.reportAfter);
      setMsg(r.data.repaired > 0 ? `${fa(r.data.repaired)} ردیف اصلاح شد.` : "چیزی برای اصلاح نبود.");
    } else {
      setErr(r.error?.message ?? "خطا در اصلاح کیفیت داده");
    }
  };

  if (err && !report) return <div className="rounded-card border border-app-err/40 bg-surface px-4 py-3 text-sm text-app-err">{err}</div>;
  if (!report) return <p className="p-6 text-sm text-muted">در حال اسکن کیفیت داده…</p>;

  const clean = report.dirtyCount === 0;

  return (
    <section className="rounded-card border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-display text-base font-bold text-ink">کیفیت داده</h3>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${clean ? "bg-app-ok/15 text-app-ok" : "bg-app-warning/15 text-app-warning"}`}>
          {clean ? "سالم" : `${fa(report.dirtyCount)} یافته`}
        </span>
        <span className="text-[11px] text-muted">
          {new Date(report.checkedAt).toLocaleString("fa-IR", { dateStyle: "short", timeStyle: "medium" })} — {fa(report.tookMs)} میلی‌ثانیه
        </span>
        <button onClick={() => void scan()} disabled={loading} className="ms-auto rounded-full border border-line px-4 py-1.5 text-xs font-bold hover:bg-app-primary-soft">
          اسکن مجدد
        </button>
      </div>

      <p className="mt-2 text-xs leading-6 text-muted">
        متن خراب (کاراکتر جانشین U+FFFD یا کنترلی) یعنی آن مقدار با انکودینگ اشتباه وارد شده و بازیابی‌شدنی نیست.
        ورودی تازه از این پس در همان لحظهٔ ذخیره رد می‌شود؛ این کارت ردیف‌های <span className="font-bold">قبلاً خراب‌شده</span> را
        نشان می‌دهد. U+FFFD در ستون مقدار با «□» نمایش داده می‌شود.
      </p>

      <div className="mt-4 grid grid-cols-3 gap-3">
        {[
          ["یافته‌ها", fa(report.dirtyCount)],
          ["ردیف‌های متأثر", fa(report.affectedRows)],
          ["قابل اصلاح خودکار", fa(report.repairableRows)],
        ].map(([label, val]) => (
          <div key={label} className="rounded-card border border-line bg-bg p-3">
            <p className="text-[11px] text-muted">{label}</p>
            <p className="mt-1 font-display text-sm font-bold text-ink tabular-nums">{val}</p>
          </div>
        ))}
      </div>

      {!clean && (
        <div className="mt-4 overflow-hidden rounded-card border border-line">
          <div className="admin-table-wrap"><table className="w-full text-xs">
            <thead className="bg-ink/5 text-muted">
              <tr>
                <th className="px-3 py-2 text-start">نوع</th>
                <th className="px-3 py-2 text-start">فیلد</th>
                <th className="px-3 py-2 text-start">دلیل</th>
                <th className="px-3 py-2 text-start">مقدار فعلی</th>
                <th className="px-3 py-2">وضعیت</th>
                <th className="px-3 py-2">اصلاح</th>
              </tr>
            </thead>
            <tbody>
              {report.findings.slice(0, 25).map((f, i) => (
                <tr key={`${f.entity}-${f.id}-${f.field}-${i}`} className="border-t border-line/60">
                  <td className="px-3 py-2 text-start">{entityLabel[f.entity]}</td>
                  <td className="px-3 py-2 text-start">{fieldLabel[f.field]}</td>
                  <td className="px-3 py-2 text-start text-app-warning">{reasonLabel[f.reason]}</td>
                  <td className="px-3 py-2 text-start font-mono text-[11px]" dir="auto">{f.value ?? "—"}</td>
                  <td className="px-3 py-2 text-center">{f.status === "PUBLISHED" ? "منتشرشده" : f.status === "ARCHIVED" ? "آرشیو" : "پیش‌نویس"}</td>
                  <td className="px-3 py-2 text-center">{f.repairable ? "خودکار" : "دستی"}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
          {report.findings.length > 25 && (
            <p className="border-t border-line/60 px-3 py-2 text-[11px] text-muted">
              {fa(report.findings.length - 25)} یافتهٔ دیگر نمایش داده نشد.
            </p>
          )}
        </div>
      )}

      {clean ? (
        <p className="mt-4 rounded-card border border-app-ok/30 bg-app-ok/10 px-3 py-2 text-xs text-ink">
          متن خرابی در محصولات، دسته‌ها و برندها نیست — همه‌چیز سالم است.
        </p>
      ) : (
        <div className="mt-4 rounded-card border border-line bg-bg p-3">
          <p className="text-xs leading-6 text-ink">
            <span className="font-bold">اصلاح خودکار (فقط محصول):</span> نام غیرقابل‌بازیابی با برچسب حقیقی
            «نام اصلی از دست رفته — SKU: …» جایگزین می‌شود، اسلاگ از SKU بازساخته می‌شود، ردیف <span className="font-bold">آرشیو</span>
            (خارج از سایت، بدون حذف سفارش/انبار) و توضیح/SEO خراب پاک می‌شود. هر ردیف AuditLog با قبل/بعد می‌گیرد.
            ردیف‌های دسته/برند چون متن جانشین ندارند فقط گزارش می‌شوند و اصلاح‌شان تصمیم اپراتور است.
          </p>
          <button
            onClick={() => void repair()}
            disabled={loading || !canRepair || report.repairableRows === 0}
            className="mt-3 rounded-full bg-app-primary px-5 py-2 text-xs font-bold text-on-accent disabled:opacity-50"
          >
            {canRepair ? "اسکن و اصلاح ردیف‌های محصول" : "نیازمند مجوز settings.manage"}
          </button>
        </div>
      )}

      {err && <p className="mt-3 text-xs text-app-err">{err}</p>}
      {msg && <p className="mt-3 text-xs text-app-ok">{msg}</p>}

      {result && result.outcomes.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-card border border-line">
          <div className="admin-table-wrap"><table className="w-full text-xs">
            <thead className="bg-ink/5 text-muted">
              <tr>
                <th className="px-3 py-2 text-start">نام قبل</th>
                <th className="px-3 py-2 text-start">نام بعد</th>
                <th className="px-3 py-2">اسلاگ →</th>
                <th className="px-3 py-2">وضعیت →</th>
                <th className="px-3 py-2">پاک‌شده</th>
              </tr>
            </thead>
            <tbody>
              {result.outcomes.map((o) => (
                <tr key={o.id} className="border-t border-line/60">
                  <td className="px-3 py-2 text-start font-mono text-[11px]" dir="auto">{o.nameBefore}</td>
                  <td className="px-3 py-2 text-start font-mono text-[11px]" dir="auto">{o.nameAfter}</td>
                  <td className="px-3 py-2 text-center font-mono text-[11px]" dir="ltr">{o.slugAfter}</td>
                  <td className="px-3 py-2 text-center">{o.statusBefore === o.statusAfter ? o.statusAfter : `${o.statusBefore} → ${o.statusAfter}`}</td>
                  <td className="px-3 py-2 text-center">{o.clearedFields.length ? o.clearedFields.join("، ") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}
    </section>
  );
}
