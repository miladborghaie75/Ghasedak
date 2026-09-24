"use client";

import { useEffect, useState } from "react";
import { useAdminApi } from "@/components/useAdminApi";

interface Term { id: string; value: string; slug: string; hex: string | null; }
interface AttributeRow {
  id: string; name: string; slug: string; type: string;
  isFilterable: boolean; isVariantAxis: boolean; terms: Term[];
}

/** ویژگی‌ها + مقادیر — رنگ با کد HEX برای سواچ */
export default function AttributesClient() {
  const { call, loading } = useAdminApi();
  const [rows, setRows] = useState<AttributeRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", type: "SELECT", isFilterable: true, isVariantAxis: false });
  const [termInputs, setTermInputs] = useState<Record<string, { value: string; hex: string }>>({});

  const load = async () => {
    const r = await call<{ items: AttributeRow[] }>("/admin/catalog/attributes");
    if (r.ok && r.data) setRows(r.data.items);
    else setError(r.error?.message ?? "خطا");
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null); setMsg(null);
    const r = await call("/admin/catalog/attributes", { method: "POST", body: JSON.stringify(form) });
    if (r.ok) { setMsg("ویژگی ایجاد شد ✅"); setForm({ name: "", type: "SELECT", isFilterable: true, isVariantAxis: false }); void load(); }
    else setError(r.error?.message ?? "خطا");
  };

  const addTerm = async (attrId: string) => {
    const t = termInputs[attrId] ?? { value: "", hex: "" };
    if (!t.value.trim()) return;
    const r = await call(`/admin/catalog/attributes/${attrId}/terms`, { method: "POST", body: JSON.stringify({ value: t.value, hex: t.hex || undefined }) });
    if (r.ok) { setTermInputs({ ...termInputs, [attrId]: { value: "", hex: "" } }); void load(); }
    else setError(r.error?.message ?? "خطا");
  };

  const delTerm = async (termId: string) => {
    if (!confirm("حذف مقدار؟")) return;
    const r = await call(`/admin/catalog/terms/${termId}`, { method: "DELETE" });
    if (r.ok) void load(); else setError(r.error?.message ?? "خطا");
  };

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={submit} className="rounded-card border border-line bg-surface p-5">
        <h2 className="text-sm font-black text-ink">ویژگی جدید</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs font-bold text-ink/70">نام ویژگی *<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="مثلاً: سایز، رنگ، نوع کاپ" className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm" /></label>
          <label className="text-xs font-bold text-ink/70">نوع
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm">
              <option value="SELECT">انتخابی</option>
              <option value="MULTISELECT">چندانتخابی</option>
              <option value="TEXT">متنی</option>
              <option value="NUMBER">عددی</option>
            </select>
          </label>
          <label className="mt-5 flex items-center gap-2 text-xs font-bold text-ink/70"><input type="checkbox" checked={form.isFilterable} onChange={(e) => setForm({ ...form, isFilterable: e.target.checked })} /> قابل فیلتر در فروشگاه</label>
          <label className="mt-5 flex items-center gap-2 text-xs font-bold text-ink/70"><input type="checkbox" checked={form.isVariantAxis} onChange={(e) => setForm({ ...form, isVariantAxis: e.target.checked })} /> محور واریانت (سایز/رنگ)</label>
        </div>
        <button type="submit" disabled={loading} className="mt-4 h-10 rounded-full bg-primary px-5 text-sm font-black text-on-accent disabled:opacity-60">افزودن ویژگی</button>
        {msg ? <p className="mt-3 text-xs font-bold text-app-ok">{msg}</p> : null}
        {error ? <p className="mt-3 text-xs font-bold text-app-err">{error}</p> : null}
      </form>

      <div className="flex flex-col gap-4">
        {rows.length === 0 ? (
          <p className="rounded-card border border-line bg-surface px-4 py-8 text-center text-sm text-ink/50">هنوز ویژگی‌ای نیست.</p>
        ) : rows.map((a) => (
          <div key={a.id} className="rounded-card border border-line bg-surface p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-black text-ink">{a.name}</span>
              <span className="rounded-full bg-ink/5 px-2 py-0.5 text-[10px] font-bold text-ink/60" dir="ltr">{a.type}</span>
              {a.isFilterable ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">فیلتر</span> : null}
              {a.isVariantAxis ? <span className="rounded-full bg-app-primary-soft px-2 py-0.5 text-[10px] font-bold text-app-warning">واریانت</span> : null}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {a.terms.map((t) => (
                <span key={t.id} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs font-bold">
                  {t.hex ? <span className="h-3 w-3 rounded-full border border-line" style={{ background: t.hex }} /> : null}
                  {t.value}
                  <button onClick={() => delTerm(t.id)} className="text-app-err">×</button>
                </span>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <input value={termInputs[a.id]?.value ?? ""} onChange={(e) => setTermInputs({ ...termInputs, [a.id]: { value: e.target.value, hex: termInputs[a.id]?.hex ?? "" } })} placeholder="مقدار جدید…" className="h-9 w-40 rounded-full border border-line bg-surface px-3 text-xs" onKeyDown={(e) => e.key === "Enter" && addTerm(a.id)} />
              <input value={termInputs[a.id]?.hex ?? ""} onChange={(e) => setTermInputs({ ...termInputs, [a.id]: { value: termInputs[a.id]?.value ?? "", hex: e.target.value } })} placeholder="#hex رنگ" dir="ltr" className="h-9 w-24 rounded-full border border-line bg-surface px-3 text-xs" />
              <button onClick={() => addTerm(a.id)} className="h-9 rounded-full bg-ink px-4 text-xs font-black text-on-accent">+ مقدار</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
