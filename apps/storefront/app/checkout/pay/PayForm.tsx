"use client";

import { useState } from "react";

function fa(n: string | number): string {
  return Number(n).toLocaleString("fa-IR");
}

/** فرم پرداخت آنلاین — در dev درگاه mock؛ زرین‌پال با credential واقعی فعال می‌شود */
export function PayForm({ code, total }: { code: string; total: number }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    const idem = `pay-${code}-${Date.now()}`;
    try {
      const res = await fetch("/api/pay/start", {
        method: "POST",
        headers: { "content-type": "application/json", "x-idempotency-key": idem },
        body: JSON.stringify({ orderCode: code, idempotencyKey: idem }),
      });
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; redirectUrl?: string; error?: { message?: string } }
        | null;
      if (!res.ok || !body?.ok || !body.redirectUrl) {
        setError(body?.error?.message ?? "شروع پرداخت ناموفق بود.");
        setBusy(false);
        return;
      }
      window.location.href = body.redirectUrl;
    } catch {
      setError("خطای شبکه؛ دوباره تلاش کنید.");
      setBusy(false);
    }
  };

  return (
    <div className="mt-5">
      <button
        type="button"
        onClick={start}
        disabled={busy}
        className="h-12 w-full rounded-full bg-primary text-sm font-black text-white disabled:opacity-60"
      >
        {busy ? "در حال انتقال به درگاه…" : `پرداخت ${fa(total)} تومان`}
      </button>
      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
      <p className="mt-3 text-[11px] leading-5 text-ink/50">
        با انتخاب روش پرداخت آنلاین به درگاه امن بانکی هدایت می‌شوید؛ مبلغ فقط پس از تایید سمت سرور نهایی می‌شود.
      </p>
    </div>
  );
}
