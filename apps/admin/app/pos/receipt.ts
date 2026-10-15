/**
 * فاز ۱۰ — بخش ۹: قالب‌های رسید — همیشه از دادهٔ persisted فاکتور ساخته می‌شوند
 * (نه state موقت cart). دو قالب: 80mm thermal و A4.
 */

export interface ReceiptItem { name: string; qty: number; unitPrice: number; lineTotal: number; }
export interface ReceiptData {
  storeName: string;
  number: string;
  createdAt: string;
  items: ReceiptItem[];
  discount: number;
  total: number;
  payments: Array<{ method: string; amount: number }>;
  customer?: string | null;
}

const esc = (s: string | number | null | undefined) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function buildReceiptHtml(d: ReceiptData): string {
  return `<!doctype html><html dir="rtl" lang="fa"><head><meta charset="utf-8"><title>${esc(d.number)}</title>
<style>
  @page { size: 80mm auto; margin: 4mm; }
  body { font-family: Tahoma, sans-serif; font-size: 12px; width: 72mm; }
  h2 { text-align: center; font-size: 14px; margin: 4px 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  td { padding: 2px 0; }
  .t { border-top: 1px dashed #000; margin-top: 6px; padding-top: 4px; font-weight: bold; }
  .c { text-align: center; }
</style></head><body>
<h2>${esc(d.storeName)}</h2>
<p class="c">فاکتور فروش ${esc(d.number)}</p>
<p class="c">${esc(new Date(d.createdAt).toLocaleString("fa-IR"))}</p>
${d.customer ? `<p class="c">مشتری: ${esc(d.customer)}</p>` : ""}
<table>
  ${d.items.map((i) => `<tr><td>${esc(i.name)}</td><td class="c">${esc(i.qty)}×</td><td>${esc(i.unitPrice)}</td><td>${esc(i.lineTotal)}</td></tr>`).join("")}
</table>
${d.discount > 0 ? `<p>تخفیف: ${esc(d.discount)}</p>` : ""}
<p class="t">قابل پرداخت: ${esc(d.total)} تومان</p>
${d.payments.map((p) => `<p class="c">${esc(p.method)}: ${esc(p.amount)}</p>`).join("")}
<p class="c">با تشکر از خریدت 💜</p>
<script>window.onload = () => { window.print(); };</script>
</body></html>`;
}

export function buildA4Html(d: ReceiptData): string {
  return `<!doctype html><html dir="rtl" lang="fa"><head><meta charset="utf-8"><title>${esc(d.number)}</title>
<style>
  @page { size: A4; margin: 18mm; }
  body { font-family: Tahoma, sans-serif; font-size: 13px; }
  h1 { font-size: 20px; border-bottom: 2px solid #000; padding-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; margin-top: 14px; }
  th, td { border: 1px solid #444; padding: 6px 8px; text-align: right; }
  th { background: #f3f0f7; }
  .meta { margin-top: 10px; color: #333; }
  .total { margin-top: 14px; font-size: 16px; font-weight: bold; }
</style></head><body>
<h1>${esc(d.storeName)} — فاکتور فروش ${esc(d.number)}</h1>
<p class="meta">تاریخ: ${esc(new Date(d.createdAt).toLocaleString("fa-IR"))}${d.customer ? ` — مشتری: ${esc(d.customer)}` : ""}</p>
<table>
  <thead><tr><th>کالا</th><th>تعداد</th><th>قیمت واحد</th><th>جمع ردیف</th></tr></thead>
  <tbody>
    ${d.items.map((i) => `<tr><td>${esc(i.name)}</td><td>${esc(i.qty)}</td><td>${esc(i.unitPrice)}</td><td>${esc(i.lineTotal)}</td></tr>`).join("")}
  </tbody>
</table>
${d.discount > 0 ? `<p>تخفیف: ${esc(d.discount)}</p>` : ""}
<p class="total">قابل پرداخت: ${esc(d.total)} تومان</p>
<p>${d.payments.map((p) => `${esc(p.method)}: ${esc(p.amount)}`).join(" — ")}</p>
<script>window.onload = () => { window.print(); };</script>
</body></html>`;
}
