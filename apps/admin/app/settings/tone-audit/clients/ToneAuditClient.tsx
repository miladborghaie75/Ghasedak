"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdminApi, fa } from "@/components/useAdminApi";
import { can } from "@/lib/session";

interface Violation {
  rule: string;
  app: string;
  file: string;
  line: number;
  text: string;
  title: string;
  detail: string;
}
interface AppSummary {
  id: string;
  label: string;
  files: number;
  pieces: number;
  violations: number;
  byRule: Record<string, number>;
}
interface Report {
  generatedAt: string;
  apps: AppSummary[];
  violations: Violation[];
}

/** وضعیت هر نقض در طول تعامل: پیش‌نویس جایگزین، پیام و مرحلهٔ تأیید */
interface RowState {
  draft: string;
  busy: "suggest" | "publish" | null;
  msg: string;
  confirm: boolean;
}

const RULE_ORDER = ["R1", "R2", "R3", "R4", "R5", "R6", "R7"];

/**
 * صفحهٔ ممیزی لحن — گزارش فقط-خواندنی از روت محلی `/api/tone-audit`
 * (قاعده‌ها از هستهٔ مشترک)، پیشنهاد جایگزین از دستیار AI (قابلیت‌ها) و
 * انتشار با تأیید دومرحله‌ای در `/api/tone-audit/publish`.
 */
export default function ToneAuditClient() {
  const { call, loading, permissions } = useAdminApi();
  const [report, setReport] = useState<Report | null>(null);
  const [err, setErr] = useState("");
  const [appFilter, setAppFilter] = useState("all");
  const [ruleFilter, setRuleFilter] = useState("all");
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const canPublish = can(permissions, "settings.manage");

  const load = useCallback(async () => {
    setErr("");
    setRows({});
    const r = await call<Report>("/tone-audit");
    if (r.ok && r.data) setReport(r.data);
    else setErr(r.error?.message ?? "ممیزی اجرا نشد؛ دوباره تلاش کن یا از مرکز عیب‌یابی وضعیت سرویس را ببین.");
  }, [call]);
  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    if (!report) return [];
    return report.violations.filter(
      (v) =>
        (appFilter === "all" || v.app === appFilter) &&
        (ruleFilter === "all" || v.rule === ruleFilter),
    );
  }, [report, appFilter, ruleFilter]);

  const keyOf = (v: Violation) => `${v.app}|${v.file}|${v.line}|${v.rule}`;

  const rowState = (k: string): RowState => rows[k] ?? { draft: "", busy: null, msg: "", confirm: false };
  const setRow = (k: string, patch: Partial<RowState>) =>
    setRows((prev) => ({ ...prev, [k]: { ...rowState(k), ...patch } }));

  /** پیشنهاد جایگزین از دستیار AI — همان قواعد ممیزی در پرامپت سرویس است */
  const suggest = async (v: Violation) => {
    const k = keyOf(v);
    setRow(k, { busy: "suggest", msg: "" });
    const r = await call<{ suggestion: string }>("/admin/capabilities/ai/suggest", {
      method: "POST",
      body: JSON.stringify({
        text: v.text,
        rule: v.rule,
        detail: v.detail,
        file: `${v.app}/${v.file}`,
      }),
    });
    if (r.ok && r.data?.suggestion) {
      setRow(k, { busy: null, draft: r.data.suggestion, msg: "" });
    } else {
      setRow(k, {
        busy: null,
        msg: r.error?.message ?? "پیشنهاد گرفته نشد؛ کلید دستیار را در «پیامک و درگاه پرداخت» تنظیم کن و دوباره تلاش کن.",
      });
    }
  };

  /** انتشار — دومرحله‌ای: نخست «انتشار»، سپس «تأیید» */
  const publish = async (v: Violation) => {
    const k = keyOf(v);
    const st = rowState(k);
    if (!st.confirm) {
      setRow(k, { confirm: true, msg: "" });
      return;
    }
    setRow(k, { busy: "publish", msg: "" });
    const r = await call<{ ok: boolean }>("/tone-audit/publish", {
      method: "POST",
      body: JSON.stringify({
        app: v.app,
        file: v.file,
        line: v.line,
        text: v.text,
        replacement: st.draft,
      }),
    });
    if (r.ok) {
      await load(); // خط‌ها بعد از تغییر جابه‌جا می‌شوند — گزارش تازه
    } else {
      setRow(k, {
        busy: null,
        confirm: false,
        msg: r.error?.message ?? "انتشار انجام نشد؛ متن را نگاه کن و دوباره تلاش کن.",
      });
    }
  };

  if (err) {
    return (
      <div className="rounded-card border border-app-err/40 bg-surface px-4 py-3 text-sm text-app-err">{err}</div>
    );
  }
  if (!report) return <p className="p-6 text-sm text-muted">در حال اجرای ممیزی…</p>;

  const total = report.violations.length;

  return (
    <div className="space-y-5">
      {/* خلاصه و فیلترها */}
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`rounded-full px-3 py-1 text-xs font-bold ${
            total === 0 ? "bg-app-ok/15 text-app-ok" : "bg-app-warning/15 text-app-warning"
          }`}
        >
          {total === 0 ? "همهٔ متن‌ها در مرز لحن‌اند" : `${fa(total)} نقض لحن`}
        </span>
        <span className="text-[11px] text-muted">
          {new Date(report.generatedAt).toLocaleString("fa-IR", { dateStyle: "short", timeStyle: "medium" })}
        </span>
        <select
          value={appFilter}
          onChange={(e) => setAppFilter(e.target.value)}
          className="rounded-full border border-line bg-surface px-3 py-1 text-xs"
        >
          <option value="all">هر دو اپ</option>
          {report.apps.map((a) => (
            <option key={a.id} value={a.id}>{`${a.label} (${fa(a.violations)})`}</option>
          ))}
        </select>
        <select
          value={ruleFilter}
          onChange={(e) => setRuleFilter(e.target.value)}
          className="rounded-full border border-line bg-surface px-3 py-1 text-xs"
        >
          <option value="all">همهٔ قاعده‌ها</option>
          {RULE_ORDER.map((rule) => (
            <option key={rule} value={rule}>{`${rule} (${fa(
              report.apps.reduce((n, a) => n + (a.byRule[rule] ?? 0), 0),
            )})`}</option>
          ))}
        </select>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="ms-auto rounded-full border border-line px-4 py-1.5 text-xs font-bold hover:bg-app-primary-soft"
        >
          اجرای ممیزی
        </button>
      </div>

      {/* کارت خلاصهٔ هر اپ */}
      <div className="grid gap-3 lg:grid-cols-2">
        {report.apps.map((a) => (
          <section key={a.id} className="rounded-card border border-line bg-surface p-4">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-ink">{a.label}</h3>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                  a.violations === 0 ? "bg-app-ok/15 text-app-ok" : "bg-app-warning/15 text-app-warning"
                }`}
              >
                {fa(a.violations)} نقض
              </span>
            </div>
            <p className="mt-2 text-xs text-muted">
              {fa(a.pieces)} قطعهٔ متن در {fa(a.files)} فایل سنجیده شد
            </p>
          </section>
        ))}
      </div>

      {/* نقض‌ها */}
      {visible.length === 0 ? (
        <p className="rounded-card border border-line bg-surface p-6 text-center text-sm text-muted">
          در این فیلتر نقضی نیست — متن‌ها در مرز لحن‌اند.
        </p>
      ) : (
        <div className="space-y-3">
          {visible.map((v) => {
            const k = keyOf(v);
            const st = rowState(k);
            const isR6 = v.rule === "R6";
            const draftReady = st.draft.trim().length > 0 && st.draft !== v.text;
            return (
              <section key={k} className="rounded-card border border-line bg-surface p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-app-err/15 px-2 py-0.5 text-[11px] font-bold text-app-err">
                    {v.rule} — {v.title}
                  </span>
                  <span className="font-mono text-[10px] text-muted" dir="ltr">
                    {v.app}/{v.file}
                    {v.line > 0 ? `:${v.line}` : ""}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-7 text-ink">«{v.text}»</p>
                <p className="mt-1 text-[11px] text-muted">{v.detail}</p>

                {isR6 ? (
                  <p className="mt-3 rounded-card border border-line bg-bg px-3 py-2 text-xs text-muted">
                    این متن در چند فایل تکرار شده؛ به جای انتشار، از منبع مشترک در کد بیاید (قاعدهٔ R6).
                  </p>
                ) : (
                  <div className="mt-3 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => void suggest(v)}
                        disabled={st.busy !== null}
                        className="rounded-full border border-line px-4 py-1.5 text-xs font-bold hover:bg-app-primary-soft disabled:opacity-50"
                      >
                        {st.busy === "suggest" ? "در حال گرفتن پیشنهاد…" : "پیشنهاد دستیار"}
                      </button>
                      {canPublish && (
                        <button
                          onClick={() => void publish(v)}
                          disabled={st.busy !== null || !draftReady}
                          className={`rounded-full px-4 py-1.5 text-xs font-bold disabled:opacity-50 ${
                            st.confirm ? "bg-app-err text-white" : "bg-ink text-white"
                          }`}
                        >
                          {st.busy === "publish"
                            ? "در حال انتشار…"
                            : st.confirm
                              ? "تأیید انتشار"
                              : "انتشار"}
                        </button>
                      )}
                      {st.confirm && (
                        <button
                          onClick={() => setRow(k, { confirm: false })}
                          className="rounded-full border border-line px-4 py-1.5 text-xs font-bold hover:bg-app-primary-soft"
                        >
                          لغو
                        </button>
                      )}
                      {!canPublish && (
                        <span className="text-[11px] text-muted">
                          انتشار فقط با مجوز «settings.manage».
                        </span>
                      )}
                    </div>
                    <textarea
                      value={st.draft}
                      onChange={(e) => setRow(k, { draft: e.target.value, confirm: false })}
                      placeholder="متن جایگزین…"
                      rows={2}
                      className="w-full rounded-card border border-line bg-bg px-3 py-2 text-sm"
                    />
                    {st.msg && <p className="text-xs text-app-err">{st.msg}</p>}
                    {st.confirm && (
                      <p className="text-xs text-app-warning">
                        با تأیید، متن در سورس جایگزین می‌شود؛ بعدش ممیزی دوباره اجرا می‌شود.
                      </p>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-muted">
        قاعده‌ها همان تست نگهبان‌اند (هستهٔ مشترک copy-rules)؛ انتشار فقط متنِ زیررشته را
        در همان خط عوض می‌کند و سورس را ساختارشده نگه می‌دارد.
      </p>
    </div>
  );
}
