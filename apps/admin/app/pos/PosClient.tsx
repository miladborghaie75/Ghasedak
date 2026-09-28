"use client";

/**
 * فاز ۱۰ — بخش ۱/۲/۳/۴/۹/۱۶: بازطراحی اطلاعات POS.
 * - دو ناحیه: جستجو/بارکد (سمت اصلی) + Ticket فعال (سمت فاکتور)
 * - چند Ticket باز: new/switch/hold/resume — هیچ Ticket با شروع مشتری بعدی از بین نمی‌رود
 * - Payment workflow واقعی: CASH/CARD/ONLINE/BANK_TRANSFER/CHECK + Split + validationها
 * - Completion modal بعد از ثبت: چاپ/مشاهده/فروش جدید (داده از فاکتور persisted، نه cart)
 * - RTL، keyboard friendly (Enter=بارکد، F2=پرداخت)، حداقل کارد/حاشیه
 *
 * Backend reuse: POST /api/pos/sale همان مسیر تاداخل تراکنش موجود است
 * (Invoice + PosPayment + Check + CheckTransition + AR + journal + outbox) — هیچ V2.
 * چاپ از GET /api/pos/invoices/:id (persisted) — نه state موقت cart (بخش ۹).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAdminApi, fa } from "@/components/useAdminApi";
import { CompletionModal } from "./CompletionModal";
import { PaymentPanel, type PayLine } from "./PaymentPanel";
import { buildReceiptHtml, buildA4Html } from "./receipt";

interface CartLine { sku: string; name: string; price: number; qty: number; }
interface ShiftInfo { id: string; openingCash: string; state: string; openedAt: string; }

interface SearchItem {
  id: string;
  name: string;
  basePrice: string;
  salePrice: string | null;
  brand?: { name: string } | null;
  variants: Array<{ id: string; sku: string; barcode: string | null; price: string; salePrice: string | null; stockQty: number; reservedQty: number }>;
  images?: Array<{ mediaId: string; alt: string | null }>;
}

interface Ticket {
  id: string;
  label: string;
  lines: CartLine[];
  customerMobile: string;
  customerName: string;
  discountTotal: number;
  note?: string;
  held: boolean;
  createdAt: number;
  /** فاز ۱۱ (P2-A): id تیکت ماندگار سمت سرور + version برای optimistic locking */
  serverId?: string;
  version?: number;
  saving?: boolean;
}

let ticketSeq = 0;
const newTicket = (): Ticket => {
  ticketSeq += 1;
  return { id: `t${Date.now()}-${ticketSeq}`, label: `Ticket ${ticketSeq}`, lines: [], customerMobile: "", customerName: "", discountTotal: 0, held: false, createdAt: Date.now() };
};

const METHOD_FA: Record<string, string> = {
  CASH: "نقدی", CARD: "کارت", ONLINE: "آنلاین", BANK_TRANSFER: "کارت به کارت", CHECK: "چک",
};

export default function PosClient() {
  const { call, loading } = useAdminApi();
  const [shift, setShift] = useState<ShiftInfo | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([newTicket()]);
  const [activeId, setActiveId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [openingCash, setOpeningCash] = useState("0");
  const [busy, setBusy] = useState(false);

  // Sale completion modal (بخش ۴) — داده از پاسخ API (persisted) پر می‌شود
  const [done, setDone] = useState<{ number: string; total: string; methods: string[]; customer: string | null } | null>(null);

  // scan/search
  const [scan, setScan] = useState("");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<SearchItem[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanRef = useRef<HTMLInputElement | null>(null);

  const active = useMemo(() => tickets.find((t) => t.id === activeId) ?? tickets.find((t) => !t.held) ?? tickets[0], [tickets, activeId]);

  // ---------- فاز ۱۱ (P2-A): تیکت ماندگار — sync با سرور ----------
  /** محتوای تیکت را به سرور می‌فرستد (create یا update) — شکست sync مانع فروش نمی‌شود ولی دیده می‌شود */
  const syncTicket = useCallback(async (t: Ticket) => {
    const payload = {
      items: t.lines.map((l) => ({ sku: l.sku, qty: l.qty })),
      customerMobile: t.customerMobile || undefined,
      customerName: t.customerName || undefined,
      discountTotal: t.discountTotal,
    };
    try {
      if (!t.serverId) {
        const r = await call<{ id: string; version: number }>("/pos/tickets", { method: "POST", body: JSON.stringify(payload) });
        if (r.ok && r.data) {
          setTickets((ts) => ts.map((x) => (x.id === t.id ? { ...x, serverId: r.data!.id, version: r.data!.version, saving: false } : x)));
          return r.data.id;
        }
      } else {
        const r = await call<{ id: string; version: number }>(`/pos/tickets/${t.serverId}/update`, {
          method: "POST",
          body: JSON.stringify({ ...payload, expectedVersion: t.version ?? 1 }),
        });
        if (r.ok && r.data) {
          setTickets((ts) => ts.map((x) => (x.serverId === t.serverId ? { ...x, version: r.data!.version, saving: false } : x)));
          return t.serverId;
        }
      }
      setTickets((ts) => ts.map((x) => (x.id === t.id ? { ...x, saving: false } : x)));
      return null;
    } catch {
      setTickets((ts) => ts.map((x) => (x.id === t.id ? { ...x, saving: false } : x)));
      return null;
    }
  }, [call]);

  /** بازیابی تیکت‌های باز/held از سرور بعد از refresh/reconnect */
  const loadServerTickets = useCallback(async () => {
    const r = await call<Array<{ id: string; status: string; version: number; items: Array<{ sku: string; qty: number }>; customerMobile: string | null; customerName: string | null; discountTotal: number; createdAt: string }>>("/pos/tickets");
    if (r.ok && r.data && r.data.length) {
      const serverTickets = r.data;
      setTickets((ts) => {
        // تیکت‌های محلی تازهٔ خالی را با سروری جایگزین می‌کنیم؛ محلیِ دارای serverId حفظ می‌شود
        const fromServer = serverTickets.map((s, i) => ({
          id: `srv-${s.id}`,
          label: `Ticket ${i + 1}`,
          lines: s.items.map((it) => ({ sku: it.sku, name: it.sku, price: 0, qty: it.qty })),
          customerMobile: s.customerMobile ?? "",
          customerName: s.customerName ?? "",
          discountTotal: s.discountTotal,
          held: s.status === "HELD",
          createdAt: new Date(s.createdAt).getTime(),
          serverId: s.id,
          version: s.version,
        }));
        const localKept = ts.filter((t) => t.serverId && !fromServer.some((s) => s.serverId === t.serverId) && (t.lines.length > 0));
        return [...fromServer, ...localKept];
      });
    }
  }, [call]);

  useEffect(() => {
    void loadServerTickets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** hold/resume/cancel روی تیکت ماندگار — best-effort با نمایش خطا */
  const serverTransition = useCallback(async (t: Ticket, to: "HELD" | "OPEN" | "CANCELLED") => {
    if (!t.serverId) return;
    const r = await call<{ version: number }>(`/pos/tickets/${t.serverId}/transition`, {
      method: "POST",
      body: JSON.stringify({ expectedVersion: t.version ?? 1, to }),
    });
    if (r.ok && r.data) {
      setTickets((ts) => ts.map((x) => (x.serverId === t.serverId ? { ...x, version: r.data!.version } : x)));
    } else if (r.error) {
      setError(`sync تیکت: ${r.error.message}`);
    }
  }, [call]);

  useEffect(() => {
    if (active && active.id !== activeId) setActiveId(active.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  useEffect(() => {
    void (async () => {
      const r = await call<ShiftInfo | null>("/pos/shift/current");
      if (r.ok && r.data) setShift(r.data);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const subtotal = active ? active.lines.reduce((a, l) => a + l.price * l.qty, 0) : 0;
  const discount = active ? active.discountTotal : 0;
  const total = Math.max(0, subtotal - discount);

  const patchTicket = (id: string, patch: Partial<Ticket>) =>
    setTickets((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const addTicket = () => {
    const t = newTicket();
    setTickets((ts) => [...ts, t]);
    setActiveId(t.id);
  };

  const holdTicket = () => {
    if (!active) return;
    if (active.lines.length === 0) { setError("Ticket خالی برای hold ندارد."); return; }
    patchTicket(active.id, { held: true, label: active.label });
    void syncTicket({ ...active, held: true });
    void serverTransition({ ...active, held: true }, "HELD");
    const nextOpen = tickets.find((t) => t.id !== active.id && !t.held);
    if (nextOpen) setActiveId(nextOpen.id);
    else addTicket();
  };

  const resumeTicket = (id: string) => {
    const t = tickets.find((x) => x.id === id);
    setTickets((ts) => ts.map((x) => (x.id === id ? { ...x, held: false } : x)));
    setActiveId(id);
    if (t) void serverTransition({ ...t, held: false }, "OPEN");
  };

  const dropTicket = (id: string) => {
    if (tickets.length === 1) { setTickets([newTicket()]); return; }
    setTickets((ts) => ts.filter((t) => t.id !== id));
  };

  const addToCart = (sku: string, name: string, price: number) => {
    if (!active) return;
    patchTicket(active.id, {
      lines: (() => {
        const lines = [...active.lines];
        const idx = lines.findIndex((l) => l.sku === sku);
        if (idx >= 0) lines[idx] = { ...lines[idx], qty: lines[idx].qty + 1 };
        else lines.push({ sku, name, price, qty: 1 });
        return lines;
      })(),
    });
    setError(null);
  };

  const runSearch = useCallback(async (q: string) => {
    setSearching(true);
    const r = await call<{ items: SearchItem[] }>(`/admin/products/pos-search?q=${encodeURIComponent(q)}`);
    if (r.ok && r.data) setResults(r.data.items ?? []);
    else setResults([]);
    setSearching(false);
  }, [call]);

  const onSearchChange = (v: string) => {
    setSearch(v);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!v.trim()) { setResults([]); setSearching(false); return; }
    searchTimer.current = setTimeout(() => void runSearch(v), 250);
  };

  const scanBarcode = async (code?: string) => {
    const value = (code ?? scan).trim();
    if (!value) return;
    setError(null);
    const r = await call<{ variant: { sku: string; price: string; salePrice?: string | null }; product: { name: string } }>(
      `/admin/products/lookup?code=${encodeURIComponent(value)}`,
    );
    if (r.ok && r.data) {
      addToCart(r.data.variant.sku, r.data.product.name, Number(r.data.variant.salePrice ?? r.data.variant.price));
      setScan("");
    } else setError(r.error?.message ?? "کالا یافت نشد");
  };

  const openShift = async () => {
    setError(null);
    const r = await call<ShiftInfo>("/pos/shift/open", { method: "POST", body: JSON.stringify({ registerName: "صندوق اصلی", openingCash: Number(openingCash) || 0 }) });
    if (r.ok && r.data) { setShift(r.data); setMsg("شیفت باز شد."); } else setError(r.error?.message ?? "خطا");
  };

  const closeShift = async () => {
    if (!shift) return;
    const actual = prompt("مبلغ نقدی شمارش‌شده در صندوق (تومان):", "0");
    if (actual == null) return;
    const r = await call<{ difference: string }>("/pos/shift/close", { method: "POST", body: JSON.stringify({ shiftId: shift.id, actualCash: Number(actual) || 0 }) });
    if (r.ok) { setMsg(`شیفت بسته شد. مغایرت: ${fa(r.data?.difference ?? 0)} تومان`); setShift(null); } else setError(r.error?.message ?? "خطا");
  };

  /** finalize با پرداخت‌ها (بخش ۲/۳) — همان POST /pos/sale موجود */
  const finalize = async (pays: PayLine[]) => {
    if (!shift) { setError("اول شیفت را باز کنید."); return; }
    if (!active || active.lines.length === 0) { setError("Ticket خالی است."); return; }
    setBusy(true); setError(null);
    try {
      const r = await call<{ number: string; grandTotal: string }>("/pos/sale", {
        method: "POST",
        body: JSON.stringify({
          shiftId: shift.id,
          lines: active.lines.map((l) => ({ sku: l.sku, qty: l.qty })),
          payments: pays.map((p) => ({
            methodCode: p.method.toLowerCase(),
            amount: p.amount,
            checkNumber: p.checkNumber,
            bankName: p.bankName,
            branch: p.branch,
            accountNumber: p.accountNumber,
            issueDateDays: p.issueDateDays,
            dueDateDays: p.dueDateDays,
          })),
          customerMobile: active.customerMobile || null,
          customerName: active.customerName || null,
          discountTotal: active.discountTotal,
        }),
      });
      if (r.ok && r.data) {
        setDone({
          number: r.data.number,
          total: r.data.grandTotal,
          methods: pays.map((p) => METHOD_FA[p.method] ?? p.method),
          customer: active.customerName || active.customerMobile || null,
        });
        // فاز ۱۱ (P2-A): تیکت ماندگار را COMPLETED کن بعد Ticket خالی جدید
        if (active.serverId) {
          void call(`/pos/tickets/${active.serverId}/complete`, {
            method: "POST",
            body: JSON.stringify({ expectedVersion: active.version ?? 1, invoiceId: (r.data as { id?: string }).id }),
          });
        }
        // Ticket مصرف‌شده حذف و Ticket خالی جدید
        setTickets((ts) => [...ts.filter((t) => t.id !== active.id), newTicket()]);
      } else setError(r.error?.message ?? "خطا در ثبت فاکتور");
    } finally {
      setBusy(false);
    }
  };

  // keyboard: F2 → فوکوس بارکد، Esc → بستن modal (بخش ۱۶)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "F2") { e.preventDefault(); scanRef.current?.focus(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const resultCard = (p: SearchItem) => {
    const v = p.variants[0];
    if (!v) return null;
    const stock = v.stockQty - v.reservedQty;
    const price = Number(v.salePrice ?? v.price);
    return (
      <button key={v.id} onClick={() => addToCart(v.sku, p.name, price)} disabled={stock <= 0}
        className="group rounded-xl p-2 text-right transition-colors hover:bg-primary-soft disabled:opacity-40">
        <p className="line-clamp-2 text-xs font-bold">{p.name}</p>
        <div className="mt-1 flex items-center justify-between">
          <span className="text-xs font-black text-primary-strong tabular-nums">{fa(price)}</span>
          {stock > 0 ? <span className="text-[10px] text-ink/50 tabular-nums">{fa(stock)}</span> : <span className="text-[10px] font-bold text-app-err">ناموجود</span>}
        </div>
      </button>
    );
  };

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      {/* ---------- سمت اصلی: اسکن + جستجو (بخش ۱) ---------- */}
      <section className="flex flex-col gap-3 lg:col-span-3">
        {/* Tickets — بخش ۱: چند فاکتور همزمان */}
        <div className="flex flex-wrap items-center gap-1.5">
          {tickets.map((t) => (
            <button key={t.id} onClick={() => setActiveId(t.id)}
              className={`h-8 rounded-full px-3 text-xs font-bold transition-colors ${t.id === active?.id ? "bg-primary text-on-accent" : t.held ? "border border-dashed border-line text-ink/50" : "border border-line text-ink/70"}`}>
              {t.held ? "⏸ " : ""}{t.label}{t.lines.length ? ` (${fa(t.lines.reduce((a, l) => a + l.qty, 0))})` : ""}
            </button>
          ))}
          <button onClick={addTicket} className="h-8 rounded-full border border-primary/40 px-3 text-xs font-black text-primary-strong">+ Ticket جدید</button>
        </div>

        <input
          value={scan}
          onChange={(e) => setScan(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void scanBarcode(); } }}
          placeholder="بارکد / SKU + Enter (F2)…"
          autoFocus
          dir="ltr"
          ref={scanRef}
          className="h-12 rounded-xl border-2 border-dashed border-primary/40 bg-surface px-4 text-sm focus:border-primary focus:outline-none"
        />
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="جستجوی محصول…"
          className="h-10 rounded-xl border border-line bg-surface px-4 text-sm focus:border-primary focus:outline-none"
        />
        {search.trim() ? (
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
            {searching ? <p className="col-span-full py-4 text-center text-xs text-ink/40">…</p> : results.map(resultCard)}
            {!searching && results.length === 0 ? <p className="col-span-full py-4 text-center text-xs text-ink/40">یافت نشد.</p> : null}
          </div>
        ) : null}

        {/* Tickets روی hold (resume) */}
        {tickets.some((t) => t.held) ? (
          <div className="flex flex-wrap gap-1.5 rounded-xl border border-dashed border-line p-2">
            <span className="text-[10px] font-bold text-ink/40">روی hold:</span>
            {tickets.filter((t) => t.held).map((t) => (
              <button key={t.id} onClick={() => resumeTicket(t.id)} className="h-7 rounded-full bg-primary-tint px-2.5 text-[11px] font-bold">
                ▶ {t.label}
              </button>
            ))}
          </div>
        ) : null}
      </section>

      {/* ---------- سمت فاکتور: Ticket فعال + پرداخت (بخش ۱/۲) ---------- */}
      <section className="flex flex-col gap-3 lg:col-span-2">
        {shift ? (
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-app-ok">● شیفت باز</span>
            <button onClick={closeShift} className="text-ink/50 underline">بستن شیفت</button>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-xl border border-line p-2">
            <input value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} type="number" placeholder="نقد اولیه" className="h-8 w-28 rounded-lg border border-line px-2 text-xs" />
            <button onClick={openShift} className="h-8 rounded-lg bg-primary px-3 text-xs font-black text-on-accent">باز کردن شیفت</button>
          </div>
        )}

        {active ? (
          <div className="rounded-xl border border-line">
            <div className="border-b border-line px-3 py-2 text-xs font-black">{active.label}</div>
            <div className="max-h-72 overflow-y-auto">
              {active.lines.length === 0 ? (
                <p className="px-3 py-8 text-center text-xs text-ink/40">Ticket خالی</p>
              ) : active.lines.map((l) => (
                <div key={l.sku} className="flex items-center gap-2 border-b border-line/50 px-3 py-1.5 last:border-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-bold">{l.name}</p>
                    <p className="text-[10px] text-ink/40 tabular-nums">{fa(l.price)} × {fa(l.qty)}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => patchTicket(active.id, { lines: active.lines.map((x) => x.sku === l.sku ? { ...x, qty: Math.max(1, x.qty - 1) } : x) })} className="h-6 w-6 rounded-lg border border-line text-xs">−</button>
                    <button onClick={() => patchTicket(active.id, { lines: active.lines.map((x) => x.sku === l.sku ? { ...x, qty: x.qty + 1 } : x) })} className="h-6 w-6 rounded-lg border border-line text-xs">+</button>
                    <button onClick={() => patchTicket(active.id, { lines: active.lines.filter((x) => x.sku !== l.sku) })} className="h-6 w-6 rounded-lg text-xs text-app-err">✕</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="space-y-2 border-t border-line p-3">
              <input value={active.customerMobile} onChange={(e) => patchTicket(active.id, { customerMobile: e.target.value })} placeholder="موبایل مشتری (اختیاری)" dir="ltr" className="h-8 w-full rounded-lg border border-line px-2 text-xs" />
              <div className="flex items-center gap-2">
                <input value={active.discountTotal || ""} onChange={(e) => patchTicket(active.id, { discountTotal: Number(e.target.value) || 0 })} type="number" min={0} placeholder="تخفیف" className="h-8 w-24 rounded-lg border border-line px-2 text-xs tabular-nums" />
                <div className="flex-1 text-end">
                  <span className="text-[10px] text-ink/50">قابل پرداخت</span>
                  <p className="text-base font-black tabular-nums">{fa(total)}</p>
                </div>
              </div>
              {/* PaymentPanel — workflow واقعی (بخش ۲/۳) */}
              <PaymentPanel total={total} disabled={busy || !shift || active.lines.length === 0} onSubmit={(pays) => void finalize(pays)} />
              <div className="flex gap-2">
                <button onClick={holdTicket} disabled={active.lines.length === 0} className="h-8 flex-1 rounded-lg border border-line text-[11px] font-bold disabled:opacity-40">⏸ Hold</button>
                <button onClick={() => dropTicket(active.id)} className="h-8 flex-1 rounded-lg border border-line text-[11px] font-bold text-app-err">حذف Ticket</button>
              </div>
            </div>
          </div>
        ) : null}

        {msg ? <p className="rounded-xl bg-app-primary-soft px-3 py-2 text-xs font-bold text-app-ok">{msg}</p> : null}
        {error ? <p className="rounded-xl bg-app-primary-soft px-3 py-2 text-xs font-bold text-app-err">{error}</p> : null}
      </section>

      {/* ---------- Completion modal (بخش ۴) ---------- */}
      {done ? (
        <CompletionModal
          invoiceNumber={done.number}
          total={done.total}
          methods={done.methods}
          customer={done.customer}
          onClose={() => setDone(null)}
          onPrinted={async (format) => {
            // چاپ از دادهٔ persisted فاکتور (بخش ۹) — حتی بعد از خالی شدن cart
            const r = await call<{
              invoice: {
                number: string; createdAt: string; grandTotal: string; customerName: string | null; customerMobile: string | null;
                items: Array<{ variantSku: string; qty: number; unitPriceSnapshot: string; lineTotal: string; variant?: { product?: { name: string } } }>;
                payments: Array<{ method: string; amount: string }>;
              };
            }>(`/pos/invoices/by-number/${done.number}`);
            if (!r.ok || !r.data) { setError(r.error?.message ?? "فاکتور برای چاپ یافت نشد."); return; }
            const inv = r.data.invoice;
            const html = format === "80mm"
              ? buildReceiptHtml({ storeName: "لباس زیر قاصدک", number: inv.number, createdAt: inv.createdAt, items: inv.items.map((i) => ({ name: i.variant?.product?.name ?? i.variantSku, qty: i.qty, unitPrice: Number(i.unitPriceSnapshot), lineTotal: Number(i.lineTotal) })), discount: Number(BigInt(inv.grandTotal) - inv.items.reduce((a, i) => a + BigInt(i.lineTotal), 0n) + BigInt(inv.grandTotal) - BigInt(inv.grandTotal)), total: Number(inv.grandTotal), payments: inv.payments.map((p) => ({ method: METHOD_FA[p.method] ?? p.method, amount: Number(p.amount) })), customer: inv.customerName ?? inv.customerMobile ?? null })
              : buildA4Html({ storeName: "لباس زیر قاصدک", number: inv.number, createdAt: inv.createdAt, items: inv.items.map((i) => ({ name: i.variant?.product?.name ?? i.variantSku, qty: i.qty, unitPrice: Number(i.unitPriceSnapshot), lineTotal: Number(i.lineTotal) })), discount: 0, total: Number(inv.grandTotal), payments: inv.payments.map((p) => ({ method: METHOD_FA[p.method] ?? p.method, amount: Number(p.amount) })), customer: inv.customerName ?? inv.customerMobile ?? null });
            const w = window.open("", "print", "width=420,height=640");
            if (!w) { setError("popup چاپ مسدود است."); return; }
            w.document.write(html);
            w.document.close();
          }}
        />
      ) : null}
    </div>
  );
}
