"use client";

import { useCallback, useEffect, useState } from "react";
import { useAdminApi } from "@/components/useAdminApi";
import { SHIPMENT_STATE_FA, type ShipmentState } from "@ghasedak/contracts";

/**
 * پنل ارسال سفارش — بند ۳۷.
 *
 * کاری که اپراتور انجام می‌دهد دقیقاً همان زنجیرهٔ واقعی است:
 *   ۱) مرسوله می‌سازد        → وضعیت «سفارش ثبت شده»
 *   ۲) کد پستی را وارد می‌کند → «بسته‌بندی شده» + کد رهگیری روی سفارش
 *   ۳) تحویل به پست          → «ارسال شده»
 *   ۴) تحویل گیرنده          → «تحویل داده شده»
 *
 * کد رهگیری را اپراتور وارد می‌کند چون کد پستی را پست در لحظهٔ تحویل
 * می‌دهد و از قبل معلوم نیست — این تصمیم آگاهانه است نه راحتی.
 *
 * وضعیت سفارش را این پنل نمی‌نویسد؛ سرور آن را هم‌گام می‌کند تا وضعیت
 * سفارش و مرسوله هرگز دو حرف نزنند.
 */

interface ShipmentRow {
  id: string;
  provider: string | null;
  providerFa: string | null;
  trackingCode: string | null;
  status: string;
  statusLabel: string;
  shippedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

const PROVIDERS = [
  { value: "post", label: "پست پیشتاز" },
  { value: "tipax", label: "تیپاکس" },
  { value: "sajha", label: "سجاد" },
  { value: "areashita", label: "آریاشیتا" },
  { value: "courier", label: "پیک" },
  { value: "pickup", label: "ارسال از شعبه" },
];

/** گذارهای بعدی مجاز هر وضعیت — با منطق سرور (`FLOW`) هم‌خوان است */
const NEXT: Record<string, ShipmentState[]> = {
  PENDING: ["LABEL_CREATED", "FAILED"],
  LABEL_CREATED: ["IN_TRANSIT", "FAILED"],
  IN_TRANSIT: ["DELIVERED", "RETURNED_TO_SENDER", "FAILED"],
  DELIVERED: [],
  RETURNED_TO_SENDER: [],
  FAILED: [],
};

function faDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("fa-IR", { dateStyle: "short", timeStyle: "short" });
}

export default function ShipmentPanel({
  orderId,
  orderCode,
  paid,
  onClose,
}: {
  orderId: string;
  orderCode: string;
  paid: boolean;
  onClose: () => void;
}) {
  const { call, loading } = useAdminApi();
  const [items, setItems] = useState<ShipmentRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [provider, setProvider] = useState("post");
  const [trackingCode, setTrackingCode] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await call<{ items: ShipmentRow[] }>(`/shipping/shipments?orderId=${encodeURIComponent(orderId)}`);
    if (r.ok && r.data) setItems(r.data.items);
  }, [call, orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const flash = (t: string, ok = true) => {
    setMsg(t);
    setError(ok ? null : t);
    setTimeout(() => {
      setMsg(null);
      setError(null);
    }, 3500);
  };

  const createShipment = async () => {
    setBusy(true);
    const r = await call("/shipping/shipments", {
      method: "POST",
      body: JSON.stringify({ orderId }),
    });
    setBusy(false);
    if (r.ok) {
      await load();
      flash("مرسوله ساخته شد — حالا کد پستی را وارد کنید.");
    } else {
      flash(r.error?.message ?? "ساخت مرسوله ناموفق", false);
    }
  };

  /** تحویل به پست — کد رهگیری ثبت و سفارش «بسته‌بندی شده» می‌شود */
  const submitLabel = async (shipmentId: string) => {
    const code = trackingCode.trim();
    if (!code) {
      flash("کد رهگیری پستی را وارد کنید.", false);
      return;
    }
    setBusy(true);
    const r = await call(`/shipping/shipments/${shipmentId}/label`, {
      method: "POST",
      body: JSON.stringify({ provider, trackingCode: code }),
    });
    setBusy(false);
    if (r.ok) {
      setTrackingCode("");
      await load();
      flash("کد رهگیری ثبت شد — مشتری آن را در صفحهٔ سفارش می‌بیند.");
    } else {
      flash(r.error?.message ?? "ثبت کد ناموفق", false);
    }
  };

  const markStatus = async (shipmentId: string, status: ShipmentState) => {
    setBusy(true);
    const r = await call(`/shipping/shipments/${shipmentId}/status`, {
      method: "POST",
      body: JSON.stringify({ status }),
    });
    setBusy(false);
    if (r.ok) {
      await load();
      flash(`وضعیت به «${SHIPMENT_STATE_FA[status]}» تغییر کرد.`);
    } else {
      flash(r.error?.message ?? "تغییر وضعیت ناموفق", false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="mt-8 w-full max-w-2xl overflow-hidden rounded-card border border-line bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-2 border-b border-line p-4">
          <h2 className="text-sm font-black text-ink">
            ارسال سفارش <span dir="ltr">{orderCode}</span>
          </h2>
          <button onClick={onClose} aria-label="بستن" className="ms-auto h-8 w-8 rounded-full border border-line text-xs font-bold">
            ✕
          </button>
        </header>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto p-4">
          {msg && (
            <p
              role="status"
              className={`rounded-xl px-3 py-2 text-[12px] font-bold ${error ? "bg-app-bg text-app-err" : "bg-primary-soft text-primary-strong"}`}
            >
              {msg}
            </p>
          )}

          {!paid && (
            <p className="rounded-xl border border-app-warning/40 bg-app-bg p-3 text-[12px] leading-6 text-app-warning">
              این سفارش پرداخت‌نشده است؛ مرسوله‌ای ساخته نمی‌شود. اول پرداخت را تأیید کنید.
            </p>
          )}

          {/* ساخت مرسوله */}
          <div className="rounded-xl border border-line bg-app-bg p-4">
            <h3 className="text-xs font-black text-ink">۱) مرسوله</h3>
            {items.length === 0 ? (
              <button
                onClick={() => void createShipment()}
                disabled={!paid || busy || loading}
                className="mt-2 rounded-full bg-primary px-4 py-2 text-xs font-black text-on-accent disabled:opacity-40"
              >
                + ساخت مرسوله
              </button>
            ) : (
              <p className="mt-2 text-[12px] text-muted">{items.length} مرسوله ثبت شده است.</p>
            )}
          </div>

          {/* مرسوله‌ها */}
          {items.map((s) => {
            const next = NEXT[s.status] ?? [];
            const canLabel = s.status === "PENDING";
            return (
              <section key={s.id} className="rounded-xl border border-line bg-surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="rounded-full bg-primary-soft px-3 py-1 text-[11px] font-bold text-primary-strong">
                    {s.statusLabel}
                  </span>
                  <span className="text-[11px] text-muted">{s.providerFa ?? "—"}</span>
                </div>

                {s.trackingCode ? (
                  <p className="mt-3 rounded-xl border border-line bg-app-bg p-3">
                    <span className="block text-[11px] font-bold text-muted">کد رهگیری پستی</span>
                    <span className="mt-0.5 block text-base font-black tracking-wider text-ink" dir="ltr">
                      {s.trackingCode}
                    </span>
                  </p>
                ) : (
                  <div className="mt-3 rounded-xl border border-dashed border-line bg-app-bg p-3">
                    <p className="text-[11px] font-bold text-muted">۲) تحویل به پست</p>
                    <p className="mt-1 text-[11px] leading-5 text-muted">
                      کد پستی را که پست هنگام تحویل داد وارد کنید. با ثبت آن، سفارش «بسته‌بندی شده» و
                      کد در صفحهٔ سفارش مشتری نمایش داده می‌شود.
                    </p>
                    {canLabel && (
                      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                        <select
                          value={provider}
                          onChange={(e) => setProvider(e.target.value)}
                          className="h-9 rounded-xl border border-line bg-surface px-2 text-[12px]"
                        >
                          {PROVIDERS.map((p) => (
                            <option key={p.value} value={p.value}>
                              {p.label}
                            </option>
                          ))}
                        </select>
                        <input
                          value={trackingCode}
                          onChange={(e) => setTrackingCode(e.target.value)}
                          dir="ltr"
                          placeholder="کد رهگیری پستی"
                          className="h-9 flex-1 rounded-xl border border-line bg-surface px-3 text-[12px]"
                        />
                        <button
                          onClick={() => void submitLabel(s.id)}
                          disabled={busy || loading || !trackingCode.trim()}
                          className="h-9 rounded-xl bg-primary px-4 text-[12px] font-black text-on-accent disabled:opacity-40"
                        >
                          ثبت کد
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <dl className="mt-3 grid gap-1 text-[11px] text-muted sm:grid-cols-3">
                  <div>
                    ساخته شد: {faDate(s.createdAt)}
                  </div>
                  <div>ارسال شد: {faDate(s.shippedAt)}</div>
                  <div>تحویل شد: {faDate(s.deliveredAt)}</div>
                </dl>

                {next.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
                    {next.map((n) => (
                      <button
                        key={n}
                        onClick={() => void markStatus(s.id, n)}
                        disabled={busy || loading}
                        className={`rounded-full border border-line px-3 py-1.5 text-[11px] font-bold disabled:opacity-40 ${
                          n === "FAILED" ? "text-app-err" : "text-primary-strong"
                        }`}
                      >
                        {SHIPMENT_STATE_FA[n]}
                      </button>
                    ))}
                  </div>
                )}
                {next.length === 0 && (
                  <p className="mt-3 border-t border-line pt-3 text-[11px] text-muted">
                    این مرسوله به وضعیت نهایی رسیده و تغییر نمی‌کند.
                  </p>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}