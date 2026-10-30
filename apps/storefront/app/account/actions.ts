"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

/**
 * اکشن‌های سمت‌سروری حساب مشتری (گام ورود/ثبت‌نام فروشگاه).
 *
 * چرا server action و نه route عمومی: کوکی نشست باید فقط همین‌جا گذاشته شود و
 * هیچ‌کدام از این مسیرها به کلاینت دسترسی مستقیم ندارد. همهٔ فراخوانی‌ها
 * سمت‌سرور به API می‌روند (بدون Origin → از گارد CSRF عبور می‌کنند) و نشستِ
 * تازه را با کوکی httpOnly روی دامنهٔ فروشگاه می‌گذارند.
 */

const API = process.env.API_ORIGIN ?? "http://localhost:4000";
const SESSION_COOKIE = "ghasedak_admin_session";
const OTP_COOKIE = "ghasedak_otp_mobile";

type ApiResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string };

async function post<T = Record<string, unknown>>(
  path: string,
  body: unknown,
  sessionToken?: string,
): Promise<ApiResult<T>> {
  const res = await fetch(`${API}/api/v1${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(sessionToken ? { cookie: `${SESSION_COOKIE}=${sessionToken}` } : {}),
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  }).catch(() => null);
  if (!res) return { ok: false, code: "API_UNAVAILABLE", message: "سرویس فروش در دسترس نیست؛ چند لحظه بعد دوباره تلاش کن." };
  const data = (await res.json().catch(() => null)) as T & {
    code?: string;
    message?: string;
    error?: { message?: string };
  } | null;
  if (!res.ok) {
    return {
      ok: false,
      code: String(data?.code ?? "ERROR"),
      message: String(data?.message ?? data?.error?.message ?? "خطایی پیش آمد؛ دوباره تلاش کن."),
    };
  }
  return { ok: true, data: data as T };
}

/** فقط مسیرهای نسبی داخلی قبول می‌شوند — هرگز مقادیر مطلق/خارجی (open-redirect) */
function safeNext(raw: unknown, fallback = "/account"): string {
  const v = String(raw ?? "").trim();
  if (!v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\")) return fallback;
  return v;
}

interface SessionPayload {
  token: string;
  expiresAt: string;
  user: { id: string; name: string | null; email: string | null; mobile: string; role: string };
}

async function establish(payload: SessionPayload, next: string): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, payload.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(payload.expiresAt),
  });
  // سبد مهمانِ همین مرورگر به حساب می‌چسبد تا بعد از ورود از دست نرود
  const cartToken = jar.get("cart_token")?.value;
  if (cartToken) {
    await fetch(`${API}/api/v1/account/cart/attach`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${payload.token}` },
      body: JSON.stringify({ token: cartToken }),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    }).catch(() => null);
  }
  redirect(safeNext(next));
}

const err = (where: string, code: string, extra = "") =>
  redirect(`/account/${where}?error=${encodeURIComponent(code)}${extra}`);

// ------------------------------------------------------------------ ورود

export async function loginAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));
  if (!email || !password) return err("login", "required", `&next=${encodeURIComponent(next)}`);

  const r = await post<SessionPayload>("/auth/login", { email, password });
  if (!r.ok) return err("login", r.code === "BAD_CREDENTIALS" ? "bad" : r.code, `&next=${encodeURIComponent(next)}`);
  // ورود ادمین از همین فرم ممکن است — بخش مشتری فقط نقش CUSTOMER را می‌پذیرد
  if (r.data.user?.role !== "CUSTOMER") return err("login", "not-customer", `&next=${encodeURIComponent(next)}`);
  await establish(r.data, next);
}

export async function otpRequestAction(formData: FormData): Promise<void> {
  const mobile = String(formData.get("mobile") ?? "").replace(/\D/g, "").replace(/^98/, "0");
  const next = safeNext(formData.get("next"));
  if (!mobile) return err("login", "required", `&next=${encodeURIComponent(next)}`);
  const r = await post("/auth/otp/request", { mobile });
  if (!r.ok) return err("login", r.code, `&next=${encodeURIComponent(next)}`);
  const jar = await cookies();
  jar.set(OTP_COOKIE, mobile, { path: "/", sameSite: "lax", httpOnly: true, maxAge: 600 });
  redirect(`/account/login?sent=1&next=${encodeURIComponent(next)}`);
}

export async function otpVerifyAction(formData: FormData): Promise<void> {
  const next = safeNext(formData.get("next"));
  const jar = await cookies();
  const mobile =
    String(formData.get("mobile") ?? "").replace(/\D/g, "") ||
    String(jar.get(OTP_COOKIE)?.value ?? "").replace(/\D/g, "");
  const code = String(formData.get("code") ?? "").trim();
  if (!mobile || !code) return err("login", "required", "&sent=1&" + `next=${encodeURIComponent(next)}`);
  const r = await post<SessionPayload>("/auth/otp/verify", { mobile, code });
  if (!r.ok) return err("login", r.code, `&sent=1&next=${encodeURIComponent(next)}`);
  jar.delete(OTP_COOKIE);
  await establish(r.data, next);
}

// ------------------------------------------------------------------ ثبت‌نام

export async function registerAction(formData: FormData): Promise<void> {
  const mobile = String(formData.get("mobile") ?? "").replace(/\D/g, "").replace(/^98/, "0");
  const password = String(formData.get("password") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const next = safeNext(formData.get("next"), "/account");
  if (!mobile || !password) return err("register", "required", `&next=${encodeURIComponent(next)}`);

  const r = await post<SessionPayload>("/auth/register", { mobile, password, name, email });
  if (!r.ok) return err("register", r.code, `&msg=${encodeURIComponent(r.message)}&next=${encodeURIComponent(next)}`);
  await establish(r.data, next);
}

// ------------------------------------------------------------------ حساب

export async function logoutAction(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await fetch(`${API}/api/v1/auth/logout`, {
      method: "POST",
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
      signal: AbortSignal.timeout(8_000),
    }).catch(() => null);
  }
  jar.delete(SESSION_COOKIE);
  redirect("/");
}

export async function saveProfileAction(formData: FormData): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) redirect("/account/login");
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const res = await fetch(`${API}/api/v1/account/me`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${token}` },
    body: JSON.stringify({ name, email }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  redirect(`/account?saved=${res?.ok ? "1" : "0"}`);
}

export async function addAddressAction(formData: FormData): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) redirect("/account/login");
  const body = {
    provinceId: String(formData.get("provinceId") ?? ""),
    cityId: String(formData.get("cityId") ?? ""),
    line: String(formData.get("line") ?? ""),
    postalCode: String(formData.get("postalCode") ?? ""),
    plaque: String(formData.get("plaque") ?? ""),
    unit: String(formData.get("unit") ?? ""),
    isDefault: formData.get("isDefault") === "on",
  };
  const res = await fetch(`${API}/api/v1/account/addresses`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  redirect(`/account?address=${res?.ok ? "1" : "0"}#addresses`);
}

export async function deleteAddressAction(formData: FormData): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) redirect("/account/login");
  const id = String(formData.get("id") ?? "");
  if (id) {
    await fetch(`${API}/api/v1/account/addresses/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
  }
  redirect("/account#addresses");
}

export async function setDefaultAddressAction(formData: FormData): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) redirect("/account/login");
  const id = String(formData.get("id") ?? "");
  if (id) {
    await fetch(`${API}/api/v1/account/addresses/${encodeURIComponent(id)}/default`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${token}` },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
  }
  redirect("/account#addresses");
}
