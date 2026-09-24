"use client";

import { useEffect, useMemo, useState } from "react";
import { useAdminApi, fa } from "@/components/useAdminApi";

interface ProductRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  basePrice: string;
  category: { name: string } | null;
  brand: { name: string } | null;
  variants: Array<{ sku: string; barcode: string | null; stockQty: number }>;
}

interface CategoryRow { id: string; name: string; parentId: string | null; description?: string | null; }
interface BrandRow { id: string; name: string; }
interface VariantForm { id?: string; sku: string; barcode: string; price: string; stockQty: string; lowStockThreshold: string; }

const EMPTY = {
  name: "", categoryId: "", brandId: "", shortDescription: "", description: "",
  basePrice: "", salePrice: "", saleStartsAt: "", saleEndsAt: "", costPrice: "",
  videoUrl: "", weightGrams: "", tags: "", status: "DRAFT",
  seoTitle: "", metaDescription: "",
};

export default function ProductsClient() {
  const { call, loading } = useAdminApi();
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [search, setSearch] = useState("");
  const [barcode, setBarcode] = useState("");
  const [barcodeHit, setBarcodeHit] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [cats, setCats] = useState<CategoryRow[]>([]);
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [form, setForm] = useState({ ...EMPTY });
  const [variants, setVariants] = useState<VariantForm[]>([]);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const load = async () => {
    const q = search ? `?q=${encodeURIComponent(search)}` : "";
    const r = await call<{ items: ProductRow[] }>(`/admin/products${q}`);
    if (r.ok && r.data) setRows(r.data.items);
  };
  useEffect(() => {
    void load();
    void call<{ items: CategoryRow[] }>("/admin/catalog/categories").then((r) => { if (r.ok && r.data) setCats(r.data.items); });
    void call<{ items: BrandRow[] }>("/admin/catalog/brands").then((r) => { if (r.ok && r.data) setBrands(r.data.items); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const searchNow = () => { void load(); };

  const lookupBarcode = async () => {
    setError(null); setBarcodeHit(null);
    if (!barcode.trim()) return;
    const r = await call<{ variant: { sku: string; price: string; stockQty: number }; product: { name: string } }>(
      `/admin/products/lookup?code=${encodeURIComponent(barcode.trim())}`,
    );
    if (r.ok && r.data) {
      setBarcodeHit(`${r.data.product.name} — SKU ${r.data.variant.sku} — ${fa(r.data.variant.price)} تومان — موجودی ${fa(r.data.variant.stockQty)}`);
    } else {
      setError(r.error?.message ?? "یافت نشد");
    }
  };

  const catTree = useMemo(() => {
    const byParent = new Map<string | null, CategoryRow[]>();
    for (const c of cats) {
      const k = c.parentId ?? null;
      (byParent.get(k) ?? byParent.set(k, []).get(k)!).push(c);
    }
    const out: Array<{ id: string; label: string }> = [];
    const walk = (p: string | null, d: number) => {
      for (const c of byParent.get(p) ?? []) {
        out.push({ id: c.id, label: `${"— ".repeat(d)}${c.name}` });
        walk(c.id, d + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [cats]);

  const addVariant = () => setVariants([...variants, { sku: "", barcode: "", price: form.basePrice, stockQty: "0", lowStockThreshold: "3" }]);
  const removeVariant = (i: number) => setVariants(variants.filter((_, idx) => idx !== i));

  const suggestSeo = async () => {
    if (!form.name || !form.categoryId) {
      setError("برای پیشنهاد SEO، نام و دسته را وارد کنید.");
      return;
    }
    // پیشنهاد قبل از ایجاد: سرویس قاعده‌محور روی نام/دسته/برند
    const cat = catTree.find((c) => c.id === form.categoryId)?.label?.trim() ?? "";
    const brandName = brands.find((b) => b.id === form.brandId)?.name ?? "";
    const brandPart = brandName ? ` ${brandName}` : "";
    const title = `${form.name}${brandPart} | لباس زیر قاصدک`.slice(0, 60);
    const meta = (form.shortDescription && form.shortDescription.length >= 50
      ? form.shortDescription
      : `${form.name}${brandPart} — ${cat} با بهترین کیفیت از لباس زیر قاصدک. ارسال سریع، ضمانت اصالت و قیمت مناسب.`
    ).slice(0, 160);
    setForm((f) => ({ ...f, seoTitle: title, metaDescription: meta }));
    setMsg("پیشنهاد SEO تولید شد (قاعده‌محور — قابل ویرایش).");
  };

  /** ویرایش — بارگذاری جزئیات محصول در همان فرم */
  const editProduct = async (id: string) => {
    setError(null); setMsg(null);
    const r = await call<{ id: string; name: string; categoryId: string; brandId: string | null; basePrice: string; salePrice: string | null; saleStartsAt: string | null; saleEndsAt: string | null; costPrice: string | null; videoUrl: string | null; weightGrams: number | null; tags: string[]; status: string; shortDescription: string | null; description: string | null; seo: { seoTitle: string | null; metaDescription: string | null } | null; variants: Array<{ id: string; sku: string; barcode: string | null; price: string; stockQty: number; lowStockThreshold: number }> }>(`/admin/products/${id}/detail`);
    if (!r.ok || !r.data) { setError(r.error?.message ?? "خطا"); return; }
    const p = r.data;
    setForm({
      name: p.name, categoryId: p.categoryId, brandId: p.brandId ?? "",
      shortDescription: p.shortDescription ?? "", description: p.description ?? "",
      basePrice: String(p.basePrice), salePrice: p.salePrice ? String(p.salePrice) : "",
      saleStartsAt: p.saleStartsAt?.slice(0, 10) ?? "", saleEndsAt: p.saleEndsAt?.slice(0, 10) ?? "",
      costPrice: p.costPrice ? String(p.costPrice) : "", videoUrl: p.videoUrl ?? "",
      weightGrams: p.weightGrams != null ? String(p.weightGrams) : "",
      tags: (p.tags ?? []).join("، "), status: p.status,
      seoTitle: p.seo?.seoTitle ?? "", metaDescription: p.seo?.metaDescription ?? "",
    });
    setVariants(p.variants.map((v) => ({ id: v.id, sku: v.sku, barcode: v.barcode ?? "", price: String(v.price), stockQty: String(v.stockQty), lowStockThreshold: String(v.lowStockThreshold) })));
    setEditId(id);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setMsg(null);
    if (!form.name || !form.categoryId || !form.basePrice) {
      setError("نام، دسته و قیمت پایه الزامی است.");
      return;
    }
    setSaving(true);
    if (editId) {
      // ویرایش — بارکد قابل تغییر (یکتایی سمت سرور چک می‌شود)
      const payload = {
        name: form.name,
        categoryId: form.categoryId,
        brandId: form.brandId || null,
        basePrice: Number(form.basePrice),
        salePrice: form.salePrice ? Number(form.salePrice) : null,
        saleStartsAt: form.saleStartsAt || null,
        saleEndsAt: form.saleEndsAt || null,
        costPrice: form.costPrice ? Number(form.costPrice) : null,
        videoUrl: form.videoUrl || null,
        weightGrams: form.weightGrams ? Number(form.weightGrams) : null,
        tags: form.tags ? form.tags.split("،").map((t) => t.trim()).filter(Boolean) : [],
        status: form.status,
        shortDescription: form.shortDescription,
        description: form.description,
        seo: form.seoTitle || form.metaDescription
          ? { seoTitle: form.seoTitle || undefined, metaDescription: form.metaDescription || undefined }
          : null,
        variants: variants.filter((v) => v.sku).map((v) => ({
          id: v.id,
          sku: v.sku,
          barcode: v.barcode || null,
          price: Number(v.price || form.basePrice),
          stockQty: Number(v.stockQty || 0),
          lowStockThreshold: Number(v.lowStockThreshold || 3),
        })),
      };
      const r = await call(`/admin/products/${editId}/full`, { method: "PUT", body: JSON.stringify(payload) });
      setSaving(false);
      if (r.ok) { setMsg("محصول ویرایش شد ✅"); setEditId(null); setForm({ ...EMPTY }); setVariants([]); setShowForm(false); void load(); }
      else setError(r.error?.message ?? "خطا در ویرایش");
      return;
    }
    const payload = {
      name: form.name,
      shortDescription: form.shortDescription || undefined,
      description: form.description || undefined,
      categoryId: form.categoryId,
      brandId: form.brandId || null,
      basePrice: Number(form.basePrice),
      salePrice: form.salePrice ? Number(form.salePrice) : null,
      saleStartsAt: form.saleStartsAt || null,
      saleEndsAt: form.saleEndsAt || null,
      costPrice: form.costPrice ? Number(form.costPrice) : null,
      videoUrl: form.videoUrl || null,
      weightGrams: form.weightGrams ? Number(form.weightGrams) : null,
      tags: form.tags ? form.tags.split("،").map((t) => t.trim()).filter(Boolean) : [],
      status: form.status,
      seo: form.seoTitle || form.metaDescription
        ? { seoTitle: form.seoTitle || undefined, metaDescription: form.metaDescription || undefined }
        : null,
      variants: variants
        .filter((v) => v.sku)
        .map((v) => ({
          sku: v.sku,
          barcode: v.barcode || null,
          price: Number(v.price || form.basePrice),
          stockQty: Number(v.stockQty || 0),
          lowStockThreshold: Number(v.lowStockThreshold || 3),
        })),
    };
    const r = await call<{ id: string }>("/admin/products/full", { method: "POST", body: JSON.stringify(payload) });
    setSaving(false);
    if (r.ok) {
      setMsg("محصول ایجاد شد ✅");
      setForm({ ...EMPTY });
      setVariants([]);
      setShowForm(false);
      void load();
    } else {
      setError(r.error?.message ?? "خطا در ایجاد محصول");
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* نوار ابزار */}
      <div className="flex flex-wrap items-center gap-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && searchNow()} placeholder="جستجو: نام محصول…" className="h-10 w-64 rounded-full border border-line bg-white px-4 text-sm" />
        <button onClick={searchNow} disabled={loading} className="h-10 rounded-full bg-ink px-5 text-sm font-black text-white disabled:opacity-60">جستجو</button>
        <div className="mx-2 h-6 w-px bg-line" />
        <input value={barcode} onChange={(e) => setBarcode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && lookupBarcode()} placeholder="بارکد / SKU…" className="h-10 w-56 rounded-full border border-line bg-white px-4 text-sm" />
        <button onClick={lookupBarcode} className="h-10 rounded-full border border-line px-4 text-sm font-bold">یافتن با بارکد</button>
        <button onClick={() => setShowForm(!showForm)} className="ms-auto h-10 rounded-full bg-primary px-5 text-sm font-black text-white">
          {showForm ? "بستن فرم" : "+ محصول جدید"}
        </button>
      </div>

      {barcodeHit ? <p className="rounded-xl bg-green-50 px-4 py-2 text-xs font-bold text-green-800">✅ {barcodeHit}</p> : null}
      {msg ? <p className="rounded-xl bg-green-50 px-4 py-2 text-xs font-bold text-green-800">{msg}</p> : null}
      {error ? <p className="rounded-xl bg-red-50 px-4 py-2 text-xs font-bold text-red-600">{error}</p> : null}

      {/* فرم محصول جدید — کامل (بند ۱۰) */}
      {showForm ? (
        <form onSubmit={submit} className="rounded-card border border-line bg-surface p-5">
          <h2 className="text-sm font-black text-ink">{editId ? "ویرایش محصول" : "تعریف محصول جدید"}</h2>
          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            <label className="text-xs font-bold text-ink/70">نام محصول *<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm" /></label>
            <label className="text-xs font-bold text-ink/70">دسته *
              <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} required className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm">
                <option value="">— انتخاب —</option>
                {catTree.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>
            <label className="text-xs font-bold text-ink/70">برند
              <select value={form.brandId} onChange={(e) => setForm({ ...form, brandId: e.target.value })} className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm">
                <option value="">— بدون برند —</option>
                {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
            <label className="text-xs font-bold text-ink/70">قیمت پایه (تومان) *<input type="number" value={form.basePrice} onChange={(e) => setForm({ ...form, basePrice: e.target.value })} required min={0} className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm" /></label>
            <label className="text-xs font-bold text-ink/70">قیمت فروش ویژه<input type="number" value={form.salePrice} onChange={(e) => setForm({ ...form, salePrice: e.target.value })} min={0} className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm" /></label>
            <label className="text-xs font-bold text-ink/70">هزینه تمام‌شده (فقط ادمین)<input type="number" value={form.costPrice} onChange={(e) => setForm({ ...form, costPrice: e.target.value })} min={0} className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm" /></label>
            <label className="text-xs font-bold text-ink/70">شروع فروش ویژه<input type="date" value={form.saleStartsAt} onChange={(e) => setForm({ ...form, saleStartsAt: e.target.value })} className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm" /></label>
            <label className="text-xs font-bold text-ink/70">پایان فروش ویژه<input type="date" value={form.saleEndsAt} onChange={(e) => setForm({ ...form, saleEndsAt: e.target.value })} className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm" /></label>
            <label className="text-xs font-bold text-ink/70">وزن (گرم)<input type="number" value={form.weightGrams} onChange={(e) => setForm({ ...form, weightGrams: e.target.value })} min={0} className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm" /></label>
            <label className="text-xs font-bold text-ink/70">ویدیو (URL)<input value={form.videoUrl} onChange={(e) => setForm({ ...form, videoUrl: e.target.value })} dir="ltr" className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm" /></label>
            <label className="text-xs font-bold text-ink/70">تگ‌ها (با ، جدا کنید)<input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm" /></label>
            <label className="text-xs font-bold text-ink/70">وضعیت
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm">
                <option value="DRAFT">پیش‌نویس</option>
                <option value="PUBLISHED">منتشرشده</option>
              </select>
            </label>
            <label className="text-xs font-bold text-ink/70 lg:col-span-2">توضیح کوتاه<input value={form.shortDescription} onChange={(e) => setForm({ ...form, shortDescription: e.target.value })} className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm" /></label>
            <label className="text-xs font-bold text-ink/70 lg:col-span-3">توضیح کامل<textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm" /></label>
          </div>

          {/* SEO */}
          <div className="mt-5 rounded-xl border border-dashed border-line p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-black text-ink">SEO</h3>
              <button type="button" onClick={suggestSeo} className="h-8 rounded-full bg-primary/10 px-3 text-xs font-black text-primary">✨ پیشنهاد هوشمند SEO</button>
            </div>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <label className="text-xs font-bold text-ink/70">عنوان SEO ({form.seoTitle.length}/60)<input value={form.seoTitle} onChange={(e) => setForm({ ...form, seoTitle: e.target.value })} maxLength={60} className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm" /></label>
              <label className="text-xs font-bold text-ink/70">توضیح متا ({form.metaDescription.length}/160)<input value={form.metaDescription} onChange={(e) => setForm({ ...form, metaDescription: e.target.value })} maxLength={160} className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm" /></label>
            </div>
          </div>

          {/* واریانت‌ها */}
          <div className="mt-5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-black text-ink">واریانت‌ها (SKU/بارکد/موجودی)</h3>
              <button type="button" onClick={addVariant} className="h-8 rounded-full border border-line px-3 text-xs font-bold">+ واریانت</button>
            </div>
            {variants.length === 0 ? <p className="mt-2 text-xs text-ink/50">بدون واریانت، یک واریانت پیش‌فرض از قیمت پایه ساخته می‌شود.</p> : null}
            <div className="mt-2 flex flex-col gap-2">
              {variants.map((v, i) => (
                <div key={i} className="grid grid-cols-2 items-center gap-2 rounded-xl border border-line p-2 sm:grid-cols-6">
                  <input value={v.sku} onChange={(e) => setVariants(variants.map((x, j) => j === i ? { ...x, sku: e.target.value } : x))} placeholder="SKU *" dir="ltr" className="rounded-lg border border-line px-2 py-1.5 text-xs" />
                  <input value={v.barcode} onChange={(e) => setVariants(variants.map((x, j) => j === i ? { ...x, barcode: e.target.value } : x))} placeholder="بارکد (قابل ویرایش)" dir="ltr" className="rounded-lg border border-line px-2 py-1.5 text-xs" />
                  <input value={v.price} onChange={(e) => setVariants(variants.map((x, j) => j === i ? { ...x, price: e.target.value } : x))} placeholder="قیمت" type="number" className="rounded-lg border border-line px-2 py-1.5 text-xs" />
                  <input value={v.stockQty} onChange={(e) => setVariants(variants.map((x, j) => j === i ? { ...x, stockQty: e.target.value } : x))} placeholder="موجودی" type="number" className="rounded-lg border border-line px-2 py-1.5 text-xs" />
                  <input value={v.lowStockThreshold} onChange={(e) => setVariants(variants.map((x, j) => j === i ? { ...x, lowStockThreshold: e.target.value } : x))} placeholder="حد هشدار" type="number" className="rounded-lg border border-line px-2 py-1.5 text-xs" />
                  <button type="button" onClick={() => removeVariant(i)} className="text-xs font-bold text-red-600">حذف</button>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-5 flex gap-2">
            <button type="submit" disabled={saving} className="h-11 rounded-full bg-primary px-6 text-sm font-black text-white disabled:opacity-60">
              {saving ? "در حال ذخیره…" : editId ? "ذخیره ویرایش" : "ایجاد محصول"}
            </button>
            <button type="button" onClick={() => { setShowForm(false); setEditId(null); setForm({ ...EMPTY }); setVariants([]); }} className="h-11 rounded-full border border-line px-6 text-sm font-bold">انصراف</button>
          </div>
        </form>
      ) : null}

      {/* جدول محصولات */}
      <div className="overflow-x-auto rounded-card border border-line bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-right text-xs text-ink/60">
              <th className="px-4 py-3">نام</th><th className="px-4 py-3">دسته</th><th className="px-4 py-3">برند</th>
              <th className="px-4 py-3">قیمت</th><th className="px-4 py-3">SKU/بارکد</th><th className="px-4 py-3">موجودی</th><th className="px-4 py-3">وضعیت</th><th className="px-4 py-3">عملیات</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-ink/50">هنوز محصولی نیست.</td></tr>
            ) : rows.map((p) => (
              <tr key={p.id} className="border-b border-line/60 last:border-0">
                <td className="px-4 py-3 font-bold">{p.name}</td>
                <td className="px-4 py-3 text-ink/60">{p.category?.name ?? "—"}</td>
                <td className="px-4 py-3 text-ink/60">{p.brand?.name ?? "—"}</td>
                <td className="px-4 py-3 tabular-nums">{fa(p.basePrice)}</td>
                <td className="px-4 py-3 text-xs" dir="ltr">
                  {p.variants?.map((v) => `${v.sku}${v.barcode ? ` (${v.barcode})` : ""}`).join(" · ") || "—"}
                </td>
                <td className="px-4 py-3 tabular-nums">{fa(p.variants?.reduce((a, v) => a + v.stockQty, 0) ?? 0)}</td>
                <td className="px-4 py-3">{p.status}</td>
                <td className="px-4 py-3">
                  <button onClick={() => void editProduct(p.id)} className="rounded-full border border-line px-3 py-1 text-xs font-bold hover:bg-primary-soft">ویرایش</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
