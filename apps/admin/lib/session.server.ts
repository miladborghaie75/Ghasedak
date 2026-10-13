/**
 * خواندن نشست ادمین — **فقط در کامپوننت‌های سروری**.
 *
 * جدا از `session.ts` چون `cookies()` از `next/headers` می‌آید و فقط در
 * سرور کار می‌کند؛ اگر این فایل به کامپوننت کلاینتی برسد، بیلد می‌شکند.
 */
import { cookies } from "next/headers";
import { api } from "./api";
import type { AdminMe } from "./session";

export async function getIdentity(): Promise<AdminMe | null> {
  const jar = await cookies();
  const cookie = jar.get("ghasedak_admin_session")?.value;
  if (!cookie) return null;
  const res = await api<AdminMe>("/auth/me", { cookie: `ghasedak_admin_session=${cookie}` });
  return res.ok ? (res.data ?? null) : null;
}

/** مثل `getIdentity` ولی به‌جای null خطا می‌دهد — برای صفحه‌های محافظت‌شده */
export async function requireIdentity(): Promise<AdminMe> {
  const me = await getIdentity();
  if (!me) throw new Error("UNAUTHENTICATED");
  return me;
}
