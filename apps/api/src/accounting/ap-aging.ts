/**
 * گزارش سن بدهی (AP aging) — گام ۱۸.
 *
 * منطق سبدبندی جدای از HTTP تا قابل تست باشد: ردیف‌های AccountsPayableِ
 * تسویه‌نشده بر اساس تاریخ سررسید (و نبودِ آن، تاریخ ثبت) به سبدِ تأخیر می‌روند.
 * مبلغِ هر ردیف «مانده» است (amount − paidAmount) — محاسبه موازی ممنوع (بند ۲۴).
 */

export const AGING_BUCKETS = ["CURRENT", "D1_30", "D31_60", "D61_90", "D90_PLUS"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export const AGING_BUCKET_LABELS: Record<AgingBucket, string> = {
  CURRENT: "جاری (سررسید نرسیده)",
  D1_30: "۱ تا ۳۰ روز تأخیر",
  D31_60: "۳۱ تا ۶۰ روز تأخیر",
  D61_90: "۶۱ تا ۹۰ روز تأخیر",
  D90_PLUS: "بیش از ۹۰ روز تأخیر",
};

const DAY_MS = 86_400_000;

/**
 * سبد تأخیر یک ردیف AP — تاریخ مرجع: سررسید؛ نبودش تاریخ ثبت.
 * تاریخ آینده/امروز → CURRENT؛ گذشته → سبد روزهای تأخیر.
 */
export function agingBucketFor(dueDate: Date | null, fallbackDate: Date, now: Date): AgingBucket {
  const ref = dueDate ?? fallbackDate;
  const overdueDays = Math.floor((now.getTime() - ref.getTime()) / DAY_MS);
  if (overdueDays <= 0) return "CURRENT";
  if (overdueDays <= 30) return "D1_30";
  if (overdueDays <= 60) return "D31_60";
  if (overdueDays <= 90) return "D61_90";
  return "D90_PLUS";
}

export type ApAgingRow = {
  supplierId: string;
  supplierName: string;
  buckets: Record<AgingBucket, string>;
  total: string;
  invoiceCount: number;
};

export type ApAgingInput = {
  supplierId: string;
  supplierName: string;
  refType: string;
  remaining: bigint;
  dueDate: Date | null;
  fallbackDate: Date;
};

/** تجميع ردیف‌های AP به سطرِ هر تامین‌کننده + جمع سبدی کل — خالص و بدون side-effect */
export function buildApAging(rows: ApAgingInput[], now: Date): {
  items: ApAgingRow[];
  totals: Record<AgingBucket, string>;
  grandTotal: string;
  asOf: string;
} {
  const perSupplier = new Map<string, { name: string; buckets: Record<AgingBucket, bigint>; count: number }>();
  const totals: Record<AgingBucket, bigint> = { CURRENT: 0n, D1_30: 0n, D31_60: 0n, D61_90: 0n, D90_PLUS: 0n };
  let grand = 0n;

  for (const r of rows) {
    if (r.remaining <= 0n) continue; // ردیف صفر/منفی مانده گزارش نمی‌شود
    const bucket = agingBucketFor(r.dueDate, r.fallbackDate, now);
    const cur = perSupplier.get(r.supplierId) ?? {
      name: r.supplierName,
      buckets: { CURRENT: 0n, D1_30: 0n, D31_60: 0n, D61_90: 0n, D90_PLUS: 0n },
      count: 0,
    };
    cur.buckets[bucket] += r.remaining;
    cur.count += 1;
    perSupplier.set(r.supplierId, cur);
    totals[bucket] += r.remaining;
    grand += r.remaining;
  }

  const items: ApAgingRow[] = [...perSupplier.entries()]
    .map(([supplierId, s]) => ({
      supplierId,
      supplierName: s.name,
      buckets: {
        CURRENT: s.buckets.CURRENT.toString(),
        D1_30: s.buckets.D1_30.toString(),
        D31_60: s.buckets.D31_60.toString(),
        D61_90: s.buckets.D61_90.toString(),
        D90_PLUS: s.buckets.D90_PLUS.toString(),
      },
      total: Object.values(s.buckets).reduce((a, b) => a + b, 0n).toString(),
      invoiceCount: s.count,
    }))
    .sort((a, b) => b.total.localeCompare(a.total, undefined, { numeric: true }));

  return {
    items,
    totals: {
      CURRENT: totals.CURRENT.toString(),
      D1_30: totals.D1_30.toString(),
      D31_60: totals.D31_60.toString(),
      D61_90: totals.D61_90.toString(),
      D90_PLUS: totals.D90_PLUS.toString(),
    },
    grandTotal: grand.toString(),
    asOf: now.toISOString(),
  };
}
