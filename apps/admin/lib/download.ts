"use client";

/**
 * دانلود خروجی CSV از API ادمین (گام ۱۲ · `[F1-2]`).
 *
 * چرا `<a href>` ساده کافی نیست: درخواست باید کوکی سشن را ببرد و پاسخ می‌تواند
 * خطا باشد؛ با لینک مستقیم کاربر به‌جای گزارش، یک صفحهٔ JSON خطا ذخیره می‌کرد و
 * نمی‌فهمید چرا. اینجا وضعیت بررسی می‌شود، نام فایل از سرصفحهٔ سرور خوانده
 * می‌شود (بازهٔ تاریخ در نام است) و خطا به‌صورت پیام به UI برمی‌گردد.
 */
export async function downloadCsv(path: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api${path}`, { cache: "no-store" });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { error?: { message?: string }; message?: string; fieldErrors?: Record<string, string[]> }
      | null;
    const fieldMsg = body?.fieldErrors ? Object.values(body.fieldErrors).flat()[0] : undefined;
    return { ok: false, error: fieldMsg ?? body?.error?.message ?? body?.message ?? "دریافت خروجی ناموفق بود." };
  }
  const blob = await res.blob();
  const disposition = res.headers.get("content-disposition") ?? "";
  const name = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? "report.csv";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return { ok: true };
}
