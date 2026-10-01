"use client";

import { useState } from "react";

interface ApiParam { name: string; in: string; type: string; required: boolean; desc: string }
interface ApiDoc {
  group: string;
  method: "GET" | "POST";
  endpoint: string;
  permission: string;
  desc: string;
  params: ApiParam[];
  sample: unknown;
}

const METHOD_STYLE: Record<string, string> = {
  GET: "bg-app-primary-soft text-primary",
  POST: "bg-app-ok/10 text-app-ok",
};

/** آکاردئون هر گروه + هدر X-API-KEY (فقط ماسک — بند ۴۵: مقدار کامل هرگز از API برنمی‌گردد) */
export default function WebServiceClient({
  groups,
  apiKey,
  authNote,
}: {
  groups: Array<{ title: string; items: ApiDoc[] }>;
  apiKey: string | null;
  authNote: string;
}) {
  const [open, setOpen] = useState<string | null>(groups[0]?.title ?? null);

  return (
    <div className="space-y-4">
      {/* هدر احراز — کلید واقعی با دکمهٔ کپی، مطابق الگوی مرجع */}
      <section className="rounded-card border border-line bg-surface p-5">
        <h3 className="font-display text-base font-bold text-ink">هدر احراز هویت</h3>
        <p className="mt-2 text-xs leading-6 text-muted">{authNote}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2" dir="ltr">
          <code className="rounded bg-bg px-2 py-1 text-xs font-bold text-ink">X-API-KEY: {apiKey ?? "—"}</code>
          <span className="text-[11px] text-muted">(نمایش ماسک‌شده — مقدار کامل فقط در فایل apps/api/.env.local است و به‌دلیل امنیتی هرگز از API برنمی‌گردد)</span>
        </div>
      </section>

      {groups.map((g) => {
        const isOpen = open === g.title;
        return (
          <section key={g.title} className="rounded-card border border-line bg-surface">
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : g.title)}
              className="flex w-full items-center justify-between px-5 py-4 text-start"
            >
              <span className="font-display text-base font-bold text-ink">{g.title}</span>
              <span className="text-xs text-muted">{isOpen ? "▲" : "▼"}</span>
            </button>
            {isOpen ? (
              <div className="space-y-4 border-t border-line px-5 py-4">
                {g.items.map((api) => (
                  <article key={api.endpoint + api.method} className="rounded-card border border-line bg-bg p-4">
                    <div className="flex flex-wrap items-center gap-2" dir="ltr">
                      <span className={`rounded px-2 py-0.5 text-[11px] font-black ${METHOD_STYLE[api.method]}`}>{api.method}</span>
                      <code className="text-xs font-bold text-ink">{api.endpoint}</code>
                    </div>
                    <p className="mt-2 text-xs leading-6 text-muted">{api.desc}</p>
                    <p className="mt-1 text-[11px] text-muted">دسترسی لازم: {api.permission}</p>
                    {api.params.length > 0 ? (
                      <div className="mt-3 overflow-x-auto">
                        <table className="w-full text-start text-xs">
                          <thead>
                            <tr className="text-muted">
                              <th className="p-1 text-start font-bold">پارامتر</th>
                              <th className="p-1 text-start font-bold">محل</th>
                              <th className="p-1 text-start font-bold">نوع</th>
                              <th className="p-1 text-start font-bold">اجباری</th>
                              <th className="p-1 text-start font-bold">توضیح</th>
                            </tr>
                          </thead>
                          <tbody>
                            {api.params.map((p) => (
                              <tr key={p.name} className="border-t border-line">
                                <td className="p-1 font-bold text-ink" dir="ltr">{p.name}</td>
                                <td className="p-1 text-muted">{p.in}</td>
                                <td className="p-1 text-muted" dir="ltr">{p.type}</td>
                                <td className="p-1">{p.required ? <span className="text-app-err">بله</span> : <span className="text-muted">خیر</span>}</td>
                                <td className="p-1 text-muted">{p.desc}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                    <div className="mt-3">
                      <p className="text-[11px] font-bold text-muted">نمونهٔ پاسخ:</p>
                      <pre className="mt-1 overflow-x-auto rounded bg-bg p-3 text-[11px] leading-5 text-ink" dir="ltr">
                        {JSON.stringify(api.sample, null, 2)}
                      </pre>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
