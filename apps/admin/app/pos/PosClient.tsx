"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAdminApi, fa } from "@/components/useAdminApi";

interface CartLine { sku: string; name?: string; price: number; qty: number; }
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

/** ترمینال POS — بارکدخوان + جستجوی زنده نام محصول (مثل سرچ سایت) + انتخاب از لیست محصولات */
export default function PosClient() {
  const { call, loading } = useAdminApi();
  const [shift, setShift] = useState<ShiftInfo | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [scan, setScan] = useState("");
  const [customerMobile, setCustomerMobile] = useState("");
  const [discountTotal, setDiscountTotal] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [lastInvoice, setLastInvoice] = useState<{ number: string; total: string } | null>(null);
  const [openingCash, setOpeningCash] = useState("0");

  // جستجوی زنده + انتخاب از لیست
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<SearchItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [showList, setShowList] = useState(false);
  const [listItems, setListItems] = useState<SearchItem[]>([]);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void (async () => {
      const r = await call<ShiftInfo | null>("/pos/shift/current");
      if (r.ok && r.data) setShift(r.data);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const subtotal = cart.reduce((a, l) => a + l.price * l.qty, 0);
  const discount = Number(discountTotal) || 0;
  const total = Math.max(0, subtotal - discount);

  const addToCart = (sku: string, name: string, price: number) => {
    setCart((c) => {
      const idx = c.findIndex((l) => l.sku === sku);
      if (idx >= 0) {
        const next = [...c];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 }; // انتخاب دوباره = افزایش تعداد
        return next;
      }
      return [...c, { sku, name, price, qty: 1 }];
    });
    setMsg(`«${name}» به سبد اضافه شد.`);
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
    searchTimer.current = setTimeout(() => void runSearch(v), 250); // debounce ۲۵۰ms
  };

  const openList = async () => {
    if (showList) { setShowList(false); return; }
    setShowList(true);
    setSearching(true);
    const r = await call<{ items: SearchItem[] }>("/admin/products/pos-search?q=");
    setListItems(r.ok && r.data ? r.data.items ?? [] : []);
    setSearching(false);
  };

  const scanBarcode = async (code?: string) => {
    const value = (code ?? scan).trim();
    if (!value) return;
    setError(null);
    const r = await call<{ variant: { sku: string; price: string; salePrice?: string | null }; product: { name: string } }>(
      `/admin/products/lookup?code=${encodeURIComponent(value)}`,
    );
    if (r.ok && r.data) {
      const unit = Number(r.data.variant.salePrice ?? r.data.variant.price);
      addToCart(r.data.variant.sku, r.data.product.name, unit);
      setScan("");
    } else {
      setError(r.error?.message ?? "کالا یافت نشد");
    }
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
    if (r.ok) {
      setMsg(`شیفت بسته شد. مغایرت: ${fa(r.data?.difference ?? 0)} تومان`);
      setShift(null);
    } else setError(r.error?.message ?? "خطا");
  };

  const submitSale = async () => {
    if (!shift) { setError("اول شیفت را باز کنید."); return; }
    if (cart.length === 0) { setError("سبد خالی است."); return; }
    setError(null); setMsg(null); setLastInvoice(null);
    const r = await call<{ number: string; grandTotal: string }>("/pos/sale", {
      method: "POST",
      body: JSON.stringify({
        shiftId: shift.id,
        lines: cart.map((l) => ({ sku: l.sku, qty: l.qty })),
        payments: [{ methodCode: "cash", amount: total }],
        customerMobile: customerMobile || null,
        discountTotal: discount,
      }),
    });
    if (r.ok && r.data) {
      setLastInvoice({ number: r.data.number, total: r.data.grandTotal });
      setCart([]); setCustomerMobile(""); setDiscountTotal("0");
      setMsg(`فاکتور ${r.data.number} ثبت شد ✅`);
    } else setError(r.error?.message ?? "خطا در ثبت فاکتور");
  };

  /** چاپ فاکتور ۸۰mm — پنجره چاپ با قالب حرارتی */
  const printReceipt = () => {
    if (!lastInvoice) return;
    const w = window.open("", "print", "width=380,height=600");
    if (!w) { setError("پنجره چاپ بسته شد — popup را اجازه دهید."); return; }
    const rows = cart;
    w.document.write(`<!doctype html><html dir="rtl" lang="fa"><head><meta charset="utf-8"><title>${lastInvoice.number}</title>
      <style>
        @page { size: 80mm auto; margin: 4mm; }
        body { font-family: Tahoma, sans-serif; font-size: 12px; width: 72mm; }
        h2 { text-align: center; font-size: 14px; margin: 4px 0; }
        table { width: 100%; border-collapse: collapse; margin-top: 6px; }
        td { padding: 2px 0; }
        .t { border-top: 1px dashed #000; margin-top: 6px; padding-top: 4px; font-weight: bold; }
        .c { text-align: center; }
      </style></head><body>
      <h2>لباس زیر قاصدک</h2>
      <p class="c">فاکتور فروش ${lastInvoice.number}</p>
      <p class="c">${new Date().toLocaleString("fa-IR")}</p>
      <table>
        ${rows.map((l) => `<tr><td>${l.name ?? ""}</td><td class="c">${l.qty}×</td><td>${fa(l.price)}</td></tr>`).join("")}
      </table>
      <p class="t">جمع: ${fa(lastInvoice.total)} تومان</p>
      <p class="c">با تشکر از خرید شما 💜</p>
      <script>window.onload = () => { window.print(); };</script>
    </body></html>`);
    w.document.close();
  };

  /** کارت نتیجه — شبیه کارت محصول سایت (تصویر/نام/قیمت/موجودی) */
  const resultCard = (p: SearchItem) => {
    const v = p.variants[0];
    if (!v) return null;
    const stock = v.stockQty - v.reservedQty;
    const price = Number(v.salePrice ?? v.price);
    return (
      <button
        key={v.id}
        onClick={() => addToCart(v.sku, p.name, price)}
        disabled={stock <= 0}
        className="group text-right disabled:opacity-50"
      >
        <div className="overflow-hidden rounded-blob bg-primary-tint">
          {p.images?.[0]?.mediaId ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/media/${p.images[0].mediaId}`} alt={p.images[0].alt ?? p.name} className="h-32 w-full object-cover transition-transform duration-300 group-hover:scale-105" />
          ) : (
            <div className="flex h-32 w-full items-center justify-center bg-gradient-to-b from-primary-tint to-primary-light text-3xl">🩱</div>
          )}
        </div>
        <p className="mt-2 line-clamp-2 min-h-10 text-xs font-bold">{p.name}</p>
        <div className="mt-1 flex items-center justify-between">
          <span className="text-xs font-black text-primary-strong tabular-nums">{fa(price)}</span>
          {stock > 0 ? (
            <span className="text-[10px] text-ink/50 tabular-nums">{fa(stock)} عدد</span>
          ) : (
            <span className="text-[10px] font-bold text-error">ناموجود</span>
          )}
        </div>
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-5">
      {/* وضعیت شیفت */}
      <div className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface p-4">
        {shift ? (
          <>
            <span className="text-sm font-bold text-green-700">● شیفت باز — از {new Date(shift.openedAt).toLocaleTimeString("fa-IR")}</span>
            <button onClick={closeShift} className="ms-auto h-9 rounded-full border border-line px-4 text-xs font-bold">بستن شیفت</button>
          </>
        ) : (
          <>
            <span className="text-sm font-bold text-ink/60">شیفت بازی نیست</span>
            <input value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} type="number" placeholder="نقد اولیه" className="h-9 w-36 rounded-full border border-line px-3 text-xs" />
            <button onClick={openShift} className="ms-auto h-9 rounded-full bg-primary px-5 text-xs font-black text-white">باز کردن شیفت</button>
          </>
        )}
      </div>

      {msg ? <p className="rounded-xl bg-green-50 px-4 py-2 text-xs font-bold text-green-800">{msg}</p> : null}
      {error ? <p className="rounded-xl bg-red-50 px-4 py-2 text-xs font-bold text-red-600">{error}</p> : null}
      {lastInvoice ? (
        <p className="rounded-xl bg-green-50 px-4 py-3 text-sm font-black text-green-800">
          ✅ فاکتور {lastInvoice.number} ثبت شد — {fa(lastInvoice.total)} تومان
        </p>
      ) : null}

      {/* بارکدخوان */}
      <div className="flex flex-wrap gap-2">
        <input
          value={scan}
          onChange={(e) => setScan(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void scanBarcode(); } }}
          placeholder="بارکد را اسکن یا SKU بنویسید و Enter بزنید…"
          autoFocus
          dir="ltr"
          className="h-11 flex-1 rounded-full border-2 border-dashed border-primary/40 bg-white px-5 text-sm focus:border-primary focus:outline-none"
        />
        <button onClick={() => scanBarcode()} disabled={loading} className="h-11 rounded-full bg-ink px-5 text-sm font-black text-white">افزودن</button>
      </div>

      {/* جستجوی زنده نام محصول — نتایج مثل سرچ سایت */}
      <div className="relative">
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="جستجو با نام محصول، برند، SKU یا بارکد…"
          className="h-11 w-full rounded-full border border-line bg-white px-5 text-sm focus:border-primary focus:outline-none"
        />
        {searching ? (
          <span className="absolute left-4 top-3.5 text-xs text-ink/40">…</span>
        ) : null}

        {search.trim() && results.length > 0 ? (
          <div className="absolute inset-x-0 top-full z-20 mt-2 max-h-96 overflow-y-auto rounded-card border border-line bg-white p-3 shadow-clay-2">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {results.map(resultCard)}
            </div>
          </div>
        ) : null}
        {search.trim() && results.length === 0 && !searching ? (
          <p className="absolute inset-x-0 top-full z-20 mt-2 rounded-card border border-line bg-white px-4 py-6 text-center text-sm text-ink/50 shadow-clay-2">
            محصولی یافت نشد.
          </p>
        ) : null}
      </div>

      {/* انتخاب از لیست محصولات */}
      <button
        onClick={() => void openList()}
        className="h-10 rounded-full border border-line px-4 text-xs font-bold text-ink/70 hover:bg-primary-tint"
      >
        {showList ? "بستن لیست محصولات" : "📋 انتخاب از لیست محصولات"}
      </button>
      {showList ? (
        <div className="max-h-96 overflow-y-auto rounded-card border border-line bg-white p-3">
          {searching ? (
            <p className="py-6 text-center text-sm text-ink/50">در حال بارگذاری…</p>
          ) : listItems.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink/50">محصولی برای فروش موجود نیست.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {listItems.map(resultCard)}
            </div>
          )}
        </div>
      ) : null}

      {/* سبد */}
      <div className="rounded-card border border-line bg-surface">
        {cart.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink/50">سبد خالی — بارکد اسکن کنید یا جستجو کنید.</p>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line text-right text-xs text-ink/60">
              <th className="px-4 py-2">کالا</th><th className="px-4 py-2">قیمت</th><th className="px-4 py-2">تعداد</th><th className="px-4 py-2">جمع</th><th className="px-4 py-2"></th>
            </tr></thead>
            <tbody>
              {cart.map((l) => (
                <tr key={l.sku} className="border-b border-line/60 last:border-0">
                  <td className="px-4 py-2 font-bold">{l.name}<span className="ms-2 text-[10px] text-ink/40" dir="ltr">{l.sku}</span></td>
                  <td className="px-4 py-2 tabular-nums">{fa(l.price)}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1">
                      <button onClick={() => setCart(cart.map((x) => x.sku === l.sku ? { ...x, qty: Math.max(1, x.qty - 1) } : x))} className="h-6 w-6 rounded-full border border-line text-xs">−</button>
                      <span className="w-8 text-center tabular-nums">{fa(l.qty)}</span>
                      <button onClick={() => setCart(cart.map((x) => x.sku === l.sku ? { ...x, qty: x.qty + 1 } : x))} className="h-6 w-6 rounded-full border border-line text-xs">+</button>
                    </div>
                  </td>
                  <td className="px-4 py-2 tabular-nums">{fa(l.price * l.qty)}</td>
                  <td className="px-4 py-2"><button onClick={() => setCart(cart.filter((x) => x.sku !== l.sku))} className="text-xs font-bold text-red-600">حذف</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* تسویه */}
      <div className="grid gap-4 rounded-card border border-line bg-surface p-5 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <label className="text-xs font-bold text-ink/70">
            موبایل مشتری (اختیاری — مشتری جدید خودکار ثبت می‌شود)
            <input value={customerMobile} onChange={(e) => setCustomerMobile(e.target.value)} placeholder="09…" dir="ltr" className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm" />
          </label>
          <label className="text-xs font-bold text-ink/70">
            تخفیف کل (تومان)
            <input value={discountTotal} onChange={(e) => setDiscountTotal(e.target.value)} type="number" min={0} className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm" />
          </label>
        </div>
        <div className="flex flex-col justify-end gap-2 lg:border-r lg:border-line lg:pe-5">
          <div className="flex justify-between text-sm"><span className="text-ink/60">جمع</span><span className="tabular-nums font-bold">{fa(subtotal)}</span></div>
          <div className="flex justify-between text-sm"><span className="text-ink/60">تخفیف</span><span className="tabular-nums font-bold text-amber-600">{fa(discount)}</span></div>
          <div className="flex justify-between border-t border-line pt-2 text-base font-black"><span>قابل پرداخت</span><span className="tabular-nums">{fa(total)}</span></div>
          <button onClick={submitSale} disabled={loading || !shift || cart.length === 0} className="h-12 rounded-full bg-primary text-sm font-black text-white disabled:opacity-50">
            ثبت فاکتور نقدی — {fa(total)} تومان
          </button>
          <button onClick={printReceipt} disabled={!lastInvoice} className="h-10 rounded-full border border-line text-xs font-bold disabled:opacity-40">
            🖨️ چاپ آخرین فاکتور (۸۰mm)
          </button>
        </div>
      </div>
    </div>
  );
}
