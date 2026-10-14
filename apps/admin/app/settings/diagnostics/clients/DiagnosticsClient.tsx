"use client";

import { useCallback, useEffect, useState } from "react";
import { useAdminApi, fa } from "@/components/useAdminApi";
import DataHealthCard from "./DataHealthCard";

interface Check {
  key: string;
  label: string;
  state: "OK" | "WARN" | "FAIL" | "SKIP";
  detail: string;
  latencyMs?: number;
  data?: Record<string, unknown>;
}
interface Diag {
  status: "OK" | "WARN" | "FAIL";
  tookMs: number;
  checkedAt: string;
  checks: Check[];
}

const stateStyle: Record<Check["state"], string> = {
  OK: "bg-app-ok/15 text-app-ok",
  WARN: "bg-app-warning/15 text-app-warning",
  FAIL: "bg-app-err/15 text-app-err",
  SKIP: "bg-app-primary-soft text-app-muted",
};
const stateLabel: Record<Check["state"], string> = {
  OK: "سالم",
  WARN: "هشدار",
  FAIL: "خطا",
  SKIP: "بی‌اثر",
};
const statusLabel: Record<Diag["status"], string> = { OK: "کل سیستم: سالم", WARN: "کل سیستم: هشدار", FAIL: "کل سیستم: خطا" };

/** مرکز عیب‌یابی — نمایش وضعیت واقعی؛ دکمهٔ «بررسی مجدد» فقط endpoint read-only را صدا می‌زند */
export default function DiagnosticsClient() {
  const { call, loading } = useAdminApi();
  const [diag, setDiag] = useState<Diag | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setErr("");
    const r = await call<Diag>("/admin/diagnostics");
    if (r.ok && r.data) setDiag(r.data);
    else setErr(r.error?.message ?? "خطا در اجرای بررسی‌ها");
  }, [call]);
  useEffect(() => { void load(); }, [load]);

  if (err) return <div className="rounded-card border border-app-err/40 bg-surface px-4 py-3 text-sm text-app-err">{err}</div>;
  if (!diag) return <p className="p-6 text-sm text-muted">در حال بررسی…</p>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${stateStyle[diag.status === "OK" ? "OK" : diag.status === "WARN" ? "WARN" : "FAIL"]}`}>
          {statusLabel[diag.status]}
        </span>
        <span className="text-[11px] text-muted">
          {new Date(diag.checkedAt).toLocaleString("fa-IR", { dateStyle: "short", timeStyle: "medium" })} — {fa(diag.tookMs)} میلی‌ثانیه
        </span>
        <button onClick={() => void load()} disabled={loading} className="ms-auto rounded-full border border-line px-4 py-1.5 text-xs font-bold hover:bg-app-primary-soft">
          بررسی مجدد
        </button>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {diag.checks.map((c) => (
          <section key={c.key} className="rounded-card border border-line bg-surface p-4">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-ink">{c.label}</h3>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${stateStyle[c.state]}`}>{stateLabel[c.state]}</span>
              {typeof c.latencyMs === "number" && <span className="ms-auto text-[10px] text-muted tnum">{fa(c.latencyMs)}ms</span>}
            </div>
            <p className="mt-2 text-xs leading-6 text-muted">{c.detail}</p>
          </section>
        ))}
      </div>

      <DataHealthCard />

      <p className="text-[11px] text-muted">
        بررسی‌های بالا فقط-خواندنی‌اند؛ تنها اکشن این صفحه «کیفیت داده» است (با AuditLog). اقدام‌های مرتبط: صف‌ها در «اعلان‌ها و صف ارسال»، کلیدها در «پیامک و درگاه پرداخت»، وضعیت بکاپ در «پشتیبان‌گیری».
      </p>
    </div>
  );
}
