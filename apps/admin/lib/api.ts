/**
 * کلاینت API ادمین — ادمین هرگز مستقیم DB را نمی‌خواند (بند ۵).
 * در سرور: fetch مطلق با API_ORIGIN + فوروارد کوکی session.
 */
export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: { code: string; message: string; fieldErrors?: Record<string, string[]> };
}

function resolve(path: string): string {
  if (typeof window !== "undefined") return `/api${path}`; // مرورگر → rewrite به API
  const origin = process.env.API_ORIGIN ?? "http://localhost:4000";
  return `${origin}/api/v1${path}`;
}

export async function api<T>(
  path: string,
  init?: RequestInit & { cookie?: string },
): Promise<ApiResult<T>> {
  const headers = new Headers(init?.headers);
  if (init?.cookie) headers.set("cookie", init.cookie);
  if (init?.body && typeof init.body === "string") {
    headers.set("content-type", "application/json");
  }
  const res = await fetch(resolve(path), {
    ...init,
    headers,
    cache: "no-store",
    redirect: "manual",
  });
  if (res.status === 204) return { ok: true, status: 204 };
  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    return { ok: false, status: res.status, error: body as ApiResult<T>["error"] };
  }
  return { ok: true, status: res.status, data: body as T };
}
