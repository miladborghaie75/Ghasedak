"use client";

import { useState, useCallback, useEffect } from "react";

let cachedPermissions: string[] | null = null;

/** کلاینت API ادمین (مرورگر) — از rewrite `/api` به API مرکزی */
export function useAdminApi() {
  const [loading, setLoading] = useState(false);
  const [permissions, setPermissions] = useState<string[]>(cachedPermissions ?? []);

  useEffect(() => {
    if (cachedPermissions) return;
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/admin/capabilities/me/permissions");
        const body = await res.json().catch(() => null) as { permissions?: string[] } | null;
        if (alive && body?.permissions) {
          cachedPermissions = body.permissions;
          setPermissions(body.permissions);
        }
      } catch {
        /* بدون permission، تب‌های محافظت‌شده پنهان می‌مانند — امن */
      }
    })();
    return () => { alive = false; };
  }, []);

  const call = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data?: T; error?: { message?: string } }> => {
      setLoading(true);
      try {
        const res = await fetch(`/api${path}`, {
          ...init,
          headers: {
            ...(init?.body ? { "content-type": "application/json" } : {}),
            ...(init?.headers ?? {}),
          },
        });
        const body = (await res.json().catch(() => null)) as unknown;
        if (!res.ok) {
          return { ok: false, status: res.status, error: body as { message?: string } };
        }
        return { ok: true, status: res.status, data: body as T };
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { call, loading, permissions };
}

/** اعداد فارسی */
export function fa(n: string | number | null | undefined): string {
  if (n == null) return "—";
  return Number(n).toLocaleString("fa-IR");
}

/**
 * آپلود فایل به کتابخانه رسانه — POST /admin/capabilities/media (بند ۳۵).
 * اعتبارسنجی mime/magic/حجم سمت سرور انجام می‌شود؛ اینجا فقط base64 می‌سازیم.
 * توسط میزکار فاکتور خرید و کتابخانه رسانه استفاده می‌شود — یک مسیر واحد.
 */
export async function uploadMedia(
  file: File,
  call: <T,>(path: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; data?: T; error?: { message?: string } }>,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const buf = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const r = await call<{ id: string; url: string }>("/admin/capabilities/media", {
    method: "POST",
    body: JSON.stringify({ filename: file.name, mime: file.type, dataBase64: btoa(binary), alt: file.name }),
  });
  return r.ok ? { ok: true, id: r.data?.id } : { ok: false, error: r.error?.message ?? "خطا در آپلود" };
}
