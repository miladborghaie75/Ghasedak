"use client";

/**
 * ProductPicker — بند ۲۷/۳۳/۳۴ Master (معماری مشترک انتخاب کالا):
 * - جستجوی نام/SKU/بارکد با نرمال‌سازی فارسی (سمت سرور: /admin/products/picker)
 * - «ایجاد سریع محصول» داخل همان دیالوگ — بدون از دست رفتن state سند
 * - بعد از ایجاد: واریانت جدید بلافاصله برمی‌گردد به فراخواننده (onPick)
 * - Quick Create دسته/برند به‌صورت inline (بند ۲۷: کنار همان فیلد)
 * این کامپوننت از فاکتور خرید، فاکتور فروش، PO و POS قابل استفاده است — بدون duplicate.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAdminApi, fa } from "@/components/useAdminApi";

export interface PickedVariant {
  sku: string;
  barcode: string | null;
  productName: string;
  price: string;
  /** آخرین بهای خرید محصول (costPrice) — پیشنهاد اولیه ردیف فاکتور خرید */
  suggestedCost: string | null;
}

interface PickerVariant {
  id: string; sku: string; barcode: string | null; price: string; stockQty: number; status: string;
}
interface PickerProduct {
  id: string; name: string; slug: string; status: string; basePrice: string; costPrice: string | null;
  category: { name: string } | null; brand: { name: string } | null;
  variants: PickerVariant[];
}

export default function ProductPicker({
  open, onClose, onPick, title = "انتخاب کالا",
}: {
  open: boolean;
  onClose: () => void;
  onPick: (v: PickedVariant) => void;
  title?: string;
}) {
  const { call } = useAdminApi();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<PickerProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (query: string) => {
    setLoading(true); setError(null);
    const r = await call<{ items: PickerProduct[] }>(`/admin/products/picker?q=${encodeURIComponent(query)}&limit=12`);
    setLoading(false);
    if (r.ok && r.data) setItems(r.data.items);
    else setError(r.error?.message ?? "خطا در جستجو");
  }, [call]);

  useEffect(() => {
    if (!open) return;
    // فوکوس اولیه + جستجوی خالی = پرفروش‌ها/آخرین‌ها
    setTimeout(() => searchRef.current?.focus(), 50);
    void search("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void search(q), 250);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, open]);

  const pick = (p: PickerProduct, v: PickerVariant) => {
    onPick({
      sku: v.sku,
      barcode: v.barcode,
      productName: p.name,
      price: v.price,
      suggestedCost: p.costPrice,
    });
    onClose();
  };

  /** بعد از quick-create: محصول تازه را جستجو و واریانت پیش‌فرضش را انتخاب کن */
  const onQuickCreated = async (sku: string) => {
    setQuickOpen(false);
    await search(sku);
    // محصول تازه اولین نتیجه SKU-matched است
    const hit = items.find((p) => p.variants.some((v) => v.sku === sku)) ?? items[0];
    if (hit) {
      const v = hit.variants.find((x) => x.sku === sku) ?? hit.variants[0];
      if (v) pick(hit, v);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 sm:p-8" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="mt-8 w-full max-w-2xl overflow-hidden rounded-card border border-line bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-line p-4">
          <h2 className="text-sm font-black text-ink">{title}</h2>
          <button onClick={onClose} aria-label="بستن" className="ms-auto h-8 w-8 rounded-full border border-line text-xs font-bold">✕</button>
        </div>
        <div className="border-b border-line p-4">
          <input
            ref={searchRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="جستجو: نام / SKU / بارکد (اسکنر هم کار می‌کند)…"
            className="h-10 w-full rounded-xl border border-line bg-surface px-4 text-sm"
            dir="auto"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-muted">نتیجه با نرمال‌سازی فارسی (ی/ي، ک/ك، ارقام فارسی) — Enter اولین واریانت را انتخاب می‌کند.</p>
            <button onClick={() => setQuickOpen(true)} className="h-8 rounded-full bg-primary px-3 text-xs font-black text-on-accent">
              + محصول جدید
            </button>
          </div>
        </div>
        {error ? <p className="p-4 text-xs font-bold text-app-err">{error}</p> : null}
        <div className="max-h-[50vh] overflow-y-auto p-2">
          {loading && items.length === 0 ? <p className="p-6 text-center text-xs text-muted">در حال جستجو…</p> : null}
          {!loading && items.length === 0 ? <p className="p-6 text-center text-xs text-muted">کالایی یافت نشد — با «+ محصول جدید» بسازید.</p> : null}
          {items.map((p) => (
            <div key={p.id} className="mb-2 rounded-xl border border-line p-2">
              <div className="flex items-center gap-2 px-1 py-1">
                <span className="text-sm font-bold text-ink">{p.name}</span>
                <span className="text-[11px] text-muted">{p.brand?.name ?? "—"} · {p.category?.name ?? "—"}</span>
                {p.status !== "PUBLISHED" ? <span className="rounded-full bg-app-warning-soft px-2 py-0.5 text-[10px] font-bold text-app-warning">{p.status === "DRAFT" ? "پیش‌نویس" : p.status}</span> : null}
              </div>
              <div className="flex flex-wrap gap-1 p-1">
                {p.variants.map((v) => (
                  <button key={v.id} onClick={() => pick(p, v)}
                    className="rounded-lg border border-line px-2 py-1 text-start text-[11px] hover:border-primary hover:bg-primary-soft"
                    title={v.barcode ? `بارکد: ${v.barcode}` : undefined}>
                    <span className="font-bold" dir="ltr">{v.sku}</span>
                    <span className="mx-1 text-muted">·</span>
                    <span className="tabular-nums">{fa(v.price)}</span>
                    <span className="mx-1 text-muted">·</span>
                    <span className={v.stockQty > 0 ? "text-app-ok" : "text-app-err"}>{fa(v.stockQty)}</span>
                  </button>
                ))}
                {p.variants.length === 0 ? <span className="px-2 py-1 text-[11px] text-muted">بدون واریانت</span> : null}
              </div>
            </div>
          ))}
        </div>
        {quickOpen ? <QuickCreateProduct onClose={() => setQuickOpen(false)} onCreated={onQuickCreated} /> : null}
      </div>
    </div>
  );
}

/** ایجاد سریع محصول (حداقلی + واریانت پیش‌فرض) — بند ۳۴: بدون خروج از سند جاری */
export function QuickCreateProduct({
  onClose, onCreated,
}: {
  onClose: () => void;
  onCreated: (sku: string) => void | Promise<void>;
}) {
  const { call } = useAdminApi();
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [brandId, setBrandId] = useState("");
  const [basePrice, setBasePrice] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [skuSuffix, setSkuSuffix] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cats, setCats] = useState<Array<{ id: string; label: string }>>([]);
  const [brands, setBrands] = useState<Array<{ id: string; name: string }>>([]);
  const [catOpen, setCatOpen] = useState(false);
  const [brandOpen, setBrandOpen] = useState(false);

  useEffect(() => {
    void (async () => {
      const [c, b] = await Promise.all([
        call<{ items: Array<{ id: string; name: string; parentId: string | null }> }>("/admin/catalog/categories"),
        call<{ items: Array<{ id: string; name: string }> }>("/admin/catalog/brands"),
      ]);
      if (c.ok && c.data) {
        // درخت مسطح با تورفتگی
        const byParent = new Map<string | null, Array<{ id: string; name: string; parentId: string | null }>>();
        for (const x of c.data.items) {
          const k = x.parentId ?? null;
          (byParent.get(k) ?? byParent.set(k, []).get(k)!).push(x);
        }
        const flat: Array<{ id: string; label: string }> = [];
        const walk = (p: string | null, d: number) => {
          for (const x of byParent.get(p) ?? []) {
            flat.push({ id: x.id, label: `${"— ".repeat(d)}${x.name}` });
            walk(x.id, d + 1);
          }
        };
        walk(null, 0);
        setCats(flat);
      }
      if (b.ok && b.data) setBrands(b.data.items);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const skuGuess = useMemo(() => {
    const base = name.replace(/[\s\u200c]+/g, "-").replace(/[^a-zA-Z0-9\u0600-\u06FF-]/g, "").slice(0, 10).toUpperCase() || "NEW";
    return `${base}-${skuSuffix || "75"}`;
  }, [name, skuSuffix]);

  const create = async () => {
    setError(null);
    if (!name.trim() || !categoryId || !Number(basePrice)) {
      setError("نام، دسته و قیمت پایه الزامی است.");
      return;
    }
    setSaving(true);
    const r = await call<{ id: string; variants: Array<{ sku: string }> }>("/admin/products/full", {
      method: "POST",
      body: JSON.stringify({
        name: name.trim(),
        categoryId,
        brandId: brandId || null,
        basePrice: Number(basePrice),
        costPrice: costPrice ? Number(costPrice) : null,
        status: "PUBLISHED",
        variants: [{ sku: skuGuess, price: Number(basePrice), stockQty: 0 }],
      }),
    });
    setSaving(false);
    if (r.ok && r.data) {
      await onCreated(r.data.variants[0]?.sku ?? skuGuess);
    } else {
      setError(r.error?.message ?? "خطا در ایجاد محصول");
    }
  };

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="ایجاد سریع محصول" onClick={onClose}>
      <div className="w-full max-w-lg rounded-card border border-line bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-black text-ink">ایجاد سریع محصول</h3>
        <p className="mt-1 text-[11px] text-muted">حداقلِ لازم برای فاکتور — ویرایش کامل بعداً از صفحه محصولات. موجودی از فاکتور خرید پر می‌شود.</p>
        <div className="mt-4 grid gap-3">
          <label className="text-xs font-bold text-ink/70">نام محصول *
            <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm" autoFocus />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-bold text-ink/70">دسته *
              <div className="mt-1 flex gap-1">
                <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="h-9 w-full rounded-xl border border-line bg-surface px-2 text-sm">
                  <option value="">— انتخاب —</option>
                  {cats.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
                <button type="button" onClick={() => setCatOpen(true)} title="دسته جدید" className="h-9 shrink-0 rounded-xl border border-line px-2 text-xs font-black">+ دسته</button>
              </div>
            </label>
            <label className="text-xs font-bold text-ink/70">برند
              <div className="mt-1 flex gap-1">
                <select value={brandId} onChange={(e) => setBrandId(e.target.value)} className="h-9 w-full rounded-xl border border-line bg-surface px-2 text-sm">
                  <option value="">— بدون برند —</option>
                  {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                <button type="button" onClick={() => setBrandOpen(true)} title="برند جدید" className="h-9 shrink-0 rounded-xl border border-line px-2 text-xs font-black">+ برند</button>
              </div>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-bold text-ink/70">قیمت پایه (تومان) *
              <input value={basePrice} onChange={(e) => setBasePrice(e.target.value)} type="number" min={0} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm tabular-nums" />
            </label>
            <label className="text-xs font-bold text-ink/70">بهای خرید (تومان)
              <input value={costPrice} onChange={(e) => setCostPrice(e.target.value)} type="number" min={0} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm tabular-nums" />
            </label>
          </div>
          <label className="text-xs font-bold text-ink/70">SKU پیشنهادی
            <div className="mt-1 flex gap-1">
              <input value={skuGuess} readOnly dir="ltr" className="h-9 w-full rounded-xl border border-line bg-surface px-2 text-xs text-muted" />
              <input value={skuSuffix} onChange={(e) => setSkuSuffix(e.target.value)} placeholder="پسوند (سایز/رنگ)" className="h-9 w-32 rounded-xl border border-line bg-surface px-2 text-xs" />
            </div>
          </label>
        </div>
        {error ? <p className="mt-3 text-xs font-bold text-app-err">{error}</p> : null}
        <div className="mt-4 flex gap-2">
          <button onClick={() => void create()} disabled={saving} className="h-10 rounded-full bg-primary px-5 text-sm font-black text-on-accent disabled:opacity-60">
            {saving ? "در حال ایجاد…" : "ایجاد و افزودن به فاکتور"}
          </button>
          <button onClick={onClose} className="h-10 rounded-full border border-line px-5 text-sm font-bold">انصراف</button>
        </div>
        {catOpen ? <QuickEntity kind="category" onClose={() => setCatOpen(false)} onCreated={async (id) => { setCatOpen(false); const c = await call<{ items: Array<{ id: string }> }>("/admin/catalog/categories"); if (c.ok && c.data) { const found = c.data.items.find((x) => x.id === id); if (found) setCategoryId(id); } }} /> : null}
        {brandOpen ? <QuickEntity kind="brand" onClose={() => setBrandOpen(false)} onCreated={async (id) => { setBrandOpen(false); const b = await call<{ items: Array<{ id: string }> }>("/admin/catalog/brands"); if (b.ok && b.data) { const found = b.data.items.find((x) => x.id === id); if (found) setBrandId(id); } }} /> : null}
      </div>
    </div>
  );
}

/** ایجاد سریع دسته/برند — بعد از ایجاد، خودکار select می‌شود (بند ۲۷) */
export function QuickEntity({
  kind, onClose, onCreated,
}: {
  kind: "category" | "brand";
  onClose: () => void;
  onCreated: (id: string) => void | Promise<void>;
}) {
  const { call } = useAdminApi();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setError(null);
    if (!name.trim()) { setError("نام الزامی است."); return; }
    setSaving(true);
    const path = kind === "category" ? "/admin/catalog/categories" : "/admin/catalog/brands";
    const r = await call<{ id: string }>(path, { method: "POST", body: JSON.stringify({ name: name.trim() }) });
    setSaving(false);
    if (r.ok && r.data) { await onCreated(r.data.id); onClose(); }
    else setError(r.error?.message ?? "خطا");
  };

  return (
    <div className="fixed inset-0 z-70 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="w-full max-w-sm rounded-card border border-line bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-black text-ink">{kind === "category" ? "دسته جدید" : "برند جدید"}</h3>
        <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void create()}
          autoFocus placeholder="نام…" className="mt-3 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm" />
        {error ? <p className="mt-2 text-xs font-bold text-app-err">{error}</p> : null}
        <div className="mt-4 flex gap-2">
          <button onClick={() => void create()} disabled={saving} className="h-9 rounded-full bg-primary px-4 text-xs font-black text-on-accent disabled:opacity-60">ایجاد</button>
          <button onClick={onClose} className="h-9 rounded-full border border-line px-4 text-xs font-bold">انصراف</button>
        </div>
      </div>
    </div>
  );
}
