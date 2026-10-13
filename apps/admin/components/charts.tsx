"use client";

import { useId, useMemo } from "react";

/**
 * نمودارهای سبک و بدون وابستگی.
 *
 * چرا دستی و نه کتابخانه (recharts و …): پنل الان ~۲۰۰KB جاوااسکریپت دارد و
 * کتابخانهٔ نمودار معمولاً ۱۵۰ تا ۳۰۰KB دیگر اضافه می‌کند — برای ۵ نمودار ساده
 * که با چند `path` و `rect` کشیده می‌شوند، این هزینه بی‌دلیل است.
 *
 * نکتهٔ دسترسی: رنگ‌ها از توکن‌های `app-*` می‌آیند تا با تم روشن/تاریک هماهنگ
 * بمانند، و هر نمودار `aria-label` و جدول جایگزین متنی دارد.
 */

export const CHART_COLORS = {
  revenue: "var(--app-primary)",
  cogs: "var(--app-err)",
  profit: "var(--app-ok)",
  line1: "var(--app-primary)",
  line2: "var(--app-err)",
  line3: "var(--app-ok)",
  muted: "var(--app-muted)",
} as const;

export interface Series {
  key: string;
  label: string;
  color: string;
  points: number[];
}

/** مقیاس‌بندی محور عمودی با اعداد «گرد» — عدد ۱٬۲۳۴٬۵۶۷۸۹۰ روی محور خوانا نیست */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  const n = v / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * mag;
}

/**
 * نمودار خطی چندسری.
 *
 * سری‌ها روی **همان مقیاس** رسم می‌شوند — اگر هرکدام مقیاس خودش را داشت،
 * مقایسه‌شان غلط می‌شد و نمودار گمراه‌کننده می‌شد.
 */
export function LineChart({
  labels,
  series,
  height = 220,
  formatValue = (v: number) => v.toLocaleString("fa-IR"),
  ariaLabel,
}: {
  labels: string[];
  series: Series[];
  height?: number;
  formatValue?: (v: number) => string;
  ariaLabel: string;
}) {
  const gid = useId().replace(/:/g, "");
  const W = 640;
  const H = height;
  const padL = 62;
  const padR = 12;
  const padT = 12;
  const padB = 26;

  const maxRaw = Math.max(
    0,
    ...series.flatMap((s) => s.points.map((p) => Math.abs(p))),
  );
  const max = niceMax(maxRaw);
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const x = (i: number, n: number) =>
    n <= 1 ? padL + innerW / 2 : padL + (innerW * i) / (n - 1);
  const y = (v: number) => padT + innerH - (Math.abs(v) / max) * innerH;

  if (labels.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-xs text-app-muted">
        در این بازه داده‌ای نیست.
      </div>
    );
  }

  // برچسب محور افقی نباید شلوغ شود — حداکثر ۶ برچسب
  const stepLabel = Math.max(1, Math.ceil(labels.length / 6));

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={ariaLabel}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={`g-${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={series[0]?.color ?? CHART_COLORS.revenue} stopOpacity="0.22" />
            <stop offset="100%" stopColor={series[0]?.color ?? CHART_COLORS.revenue} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* خطوط راهنما + برچسب محور عمودی */}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line
              x1={padL}
              x2={W - padR}
              y1={padT + innerH * f}
              y2={padT + innerH * f}
              stroke="var(--app-line)"
              strokeWidth="1"
              strokeDasharray={f === 1 ? undefined : "3 3"}
            />
            <text
              x={padL - 6}
              y={padT + innerH * f + 3}
              textAnchor="end"
              fontSize="9"
              fill={CHART_COLORS.muted}
            >
              {formatValue(max * (1 - f))}
            </text>
          </g>
        ))}

        {/* برچسب محور افقی */}
        {labels.map((l, i) =>
          i % stepLabel === 0 || i === labels.length - 1 ? (
            <text
              key={`${l}-${i}`}
              x={x(i, labels.length)}
              y={H - 8}
              textAnchor="middle"
              fontSize="9"
              fill={CHART_COLORS.muted}
            >
              {l}
            </text>
          ) : null,
        )}

        {/* ناحیه زیر خط اول فقط وقتی یک‌سری باشد (تمیزتر) */}
        {series.length === 1 && series[0].points.length > 1 && (
          <>
            <path
              d={
                `M ${x(0, labels.length)} ${padT + innerH} ` +
                series[0].points.map((p, i) => `L ${x(i, labels.length)} ${y(p)}`).join(" ") +
                ` L ${x(labels.length - 1, labels.length)} ${padT + innerH} Z`
              }
              fill={`url(#g-${gid})`}
            />
            <path
              d={series[0].points
                .map((p, i) => `${i === 0 ? "M" : "L"} ${x(i, labels.length)} ${y(p)}`)
                .join(" ")}
              fill="none"
              stroke={series[0].color}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        )}

        {/* بقیهٔ سری‌ها */}
        {series.map((s, si) =>
          si === 0 ? null : (
            <path
              key={s.key}
              d={s.points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i, labels.length)} ${y(p)}`).join(" ")}
              fill="none"
              stroke={s.color}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ),
        )}

        {/* نقطهٔ آخر هر سری — بدون برچسب، فقط برای خوانایی */}
        {series.map((s) => (
          <circle
            key={`d-${s.key}`}
            cx={x(s.points.length - 1, labels.length)}
            cy={y(s.points[s.points.length - 1] ?? 0)}
            r="3"
            fill={s.color}
          />
        ))}
      </svg>

      {/* راهنما — رنگ‌ها بدون رنگ قابل تشخیص نیستند */}
      <div className="mt-2 flex flex-wrap gap-3">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-[10px] text-app-muted">
            <span className="size-2.5 rounded-full" style={{ background: s.color }} aria-hidden />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * نمودار ستونی افقی — برای تفکیک (سهم هزینه‌ها، فروش هر کانال).
 * افقی است چون نام‌ها فارسی و بلندند و در ستون عمودی جا نمی‌شوند.
 */
export function BarList({
  items,
  formatValue = (v: number) => v.toLocaleString("fa-IR"),
  ariaLabel,
}: {
  items: Array<{ label: string; value: number; share?: number | null; color?: string }>;
  formatValue?: (v: number) => string;
  ariaLabel: string;
}) {
  const max = Math.max(1, ...items.map((i) => Math.abs(i.value)));
  const palette = [
    "var(--app-primary)",
    "var(--app-err)",
    "var(--app-ok)",
    "var(--app-warning)",
    "var(--app-info)",
  ];

  if (items.length === 0) {
    return (
      <div className="flex h-24 items-center justify-center text-xs text-app-muted">
        داده‌ای برای نمایش نیست.
      </div>
    );
  }

  return (
    <div className="space-y-2" role="img" aria-label={ariaLabel}>
      {items.map((it, i) => (
        <div key={it.label}>
          <div className="mb-0.5 flex items-baseline justify-between gap-2">
            <span className="truncate text-[11px] font-bold text-ink">{it.label}</span>
            <span className="shrink-0 text-[11px] tabular-nums text-app-muted">
              {formatValue(it.value)}
              {it.share != null && (
                <span className="ms-1 opacity-70">
                  ({(it.share * 100).toLocaleString("fa-IR", { maximumFractionDigits: 0 })}٪)
                </span>
              )}
            </span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-app-line/50">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max(2, (Math.abs(it.value) / max) * 100)}%`,
                background: it.color ?? palette[i % palette.length],
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** حالت خالیِ صادقانه — با دلیل، نه فقط «داده‌ای نیست» */
export function ChartEmpty({ reason }: { reason?: string | null }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-card border border-dashed border-app-line bg-app-surface/40 px-4 py-10 text-center">
      <p className="text-xs font-bold text-ink">داده‌ای برای این بازه ثبت نشده است</p>
      {reason ? (
        <p className="max-w-sm text-[11px] leading-5 text-app-muted">{reason}</p>
      ) : (
        <p className="text-[11px] text-app-muted">
          به‌محض ثبت اولین سند مالی، نمودار خودکار پر می‌شود.
        </p>
      )}
    </div>
  );
}

/** جدول جایگزین نمودار — برای صفحه‌خوان و وقتی داده کم است و نمودار گمراه‌کننده می‌شود */
export function SeriesTable({
  labels,
  series,
  formatValue = (v: number) => v.toLocaleString("fa-IR"),
}: {
  labels: string[];
  series: Series[];
  formatValue?: (v: number) => string;
}) {
  return (
    <div className="admin-table-wrap mt-2 max-h-56 overflow-y-auto">
      <table className="w-full text-[11px]">
        <thead className="sticky top-0 bg-app-surface">
          <tr className="border-b border-app-line text-right text-app-muted">
            <th className="px-2 py-1">بازه</th>
            {series.map((s) => (
              <th key={s.key} className="px-2 py-1 text-end">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((l, i) => (
            <tr key={l} className="border-b border-app-line/40">
              <td className="px-2 py-1">{l}</td>
              {series.map((s) => (
                <td key={s.key} className="px-2 py-1 text-end tabular-nums">
                  {formatValue(s.points[i] ?? 0)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** بازهٔ زمانی انتخابی — مشترک بین همهٔ نمودارها */
export function RangePicker({
  from,
  to,
  preset,
  onChange,
}: {
  from: string;
  to: string;
  preset: string;
  onChange: (next: { from: string; to: string; preset: string }) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const presets: Array<{ key: string; label: string; days: number }> = [
    { key: "7d", label: "۷ روز", days: 7 },
    { key: "30d", label: "۳۰ روز", days: 30 },
    { key: "90d", label: "۹۰ روز", days: 90 },
    { key: "180d", label: "۶ ماه", days: 180 },
    { key: "365d", label: "۱ سز", days: 365 },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap overflow-hidden rounded-xl border border-app-line">
        {presets.map((p) => (
          <button
            key={p.key}
            onClick={() => {
              const end = new Date();
              const start = new Date();
              start.setDate(start.getDate() - p.days);
              onChange({ from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10), preset: p.key });
            }}
            className={`h-9 px-3 text-[11px] font-bold ${
              preset === p.key ? "bg-primary text-on-accent" : "bg-surface text-app-muted"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <span className="text-[11px] text-app-muted">یا:</span>
      <input
        type="date"
        value={from}
        max={to}
        onChange={(e) => onChange({ from: e.target.value, to, preset: "custom" })}
        className="h-9 rounded-xl border border-app-line bg-surface px-2 text-[11px]"
        aria-label="از تاریخ"
      />
      <span className="text-[11px] text-app-muted">تا</span>
      <input
        type="date"
        value={to}
        min={from}
        max={today}
        onChange={(e) => onChange({ from, to: e.target.value, preset: "custom" })}
        className="h-9 rounded-xl border border-app-line bg-surface px-2 text-[11px]"
        aria-label="تا تاریخ"
      />
    </div>
  );
}

/** کارت وضعیت — مشترک بین همهٔ بخش‌های داشبورد */
export function StatCard({
  label,
  value,
  sub,
  tone = "ok",
  href,
}: {
  label: string;
  value: string;
  sub?: string | null;
  tone?: "ok" | "err" | "warn" | "plain";
  href?: string;
}) {
  const cls = {
    ok: "border-app-line",
    err: "border-app-err/40 bg-app-err/5",
    warn: "border-app-warning/40 bg-app-warning/5",
    plain: "border-app-line",
  }[tone];

  const inner = (
    <>
      <p className="text-[11px] font-bold text-app-muted">{label}</p>
      <p className="mt-1 text-base font-black tabular-nums text-ink">{value}</p>
      {sub ? <p className="text-[10px] text-app-muted tabular-nums">{sub}</p> : null}
    </>
  );

  return href ? (
    <a href={href} className={`block rounded-card border bg-surface p-3 transition-colors hover:border-primary-soft ${cls}`}>
      {inner}
    </a>
  ) : (
    <div className={`rounded-card border bg-surface p-3 ${cls}`}>{inner}</div>
  );
}

/** عدد با جداکنندهٔ فارسی — همهٔ ارقام فارسی */
export const fa = (v: number | string | null | undefined): string =>
  Number(v ?? 0).toLocaleString("fa-IR");

/** خلاصهٔ یک بازه از نقطه‌ها — برای کارت‌ها */
export function useTrendSummary(points: Array<{ period: string; revenue: number; profit: number }>) {
  return useMemo(() => {
    if (points.length === 0) return null;
    return {
      last: points[points.length - 1],
      first: points[0],
      peak: points.reduce((m, p) => (p.revenue > m.revenue ? p : m), points[0]),
      revenue: points.reduce((s, p) => s + p.revenue, 0),
      profit: points.reduce((s, p) => s + p.profit, 0),
    };
  }, [points]);
}