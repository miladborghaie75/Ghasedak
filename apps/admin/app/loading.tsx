/**
 * بارگذاری ریشهٔ پنل (گام ۱۰) — اسکلتون پوستهٔ داشبورد در همان زبان بصری
 * ادمین (کارت روشن با نبض ملایم). عملگر حس انتظار صامت می‌گیرد، نه اسپینر.
 * سگمنت‌های سنگین (لیست‌ها) loading خودشان را دارند؛ این پوستهٔ اولیه است.
 */
export default function AdminLoading() {
  return (
    <div role="status" aria-label="در حال بارگذاری" className="space-y-6">
      <div className="animate-pulse space-y-2">
        <div className="h-6 w-48 rounded-full bg-primary-soft/50" />
        <div className="h-3.5 w-80 max-w-full rounded-full bg-primary-soft/40" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="animate-pulse rounded-card border border-line bg-surface p-4">
            <div className="h-3 w-20 rounded-full bg-primary-soft/40" />
            <div className="mt-3 h-7 w-28 rounded-full bg-primary-soft/50" />
          </div>
        ))}
      </div>
      <div className="animate-pulse rounded-card border border-line bg-surface p-4">
        <div className="h-3.5 w-full rounded-full bg-primary-soft/40" />
        <div className="mt-3 h-3.5 w-5/6 rounded-full bg-primary-soft/30" />
        <div className="mt-3 h-3.5 w-2/3 rounded-full bg-primary-soft/30" />
      </div>
    </div>
  );
}
