import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";

/**
 * گارد CSRF برای اکشن‌های حساس مالی/حسابداری (گام ۲۲ — بستهٔ B).
 *
 * چرا لازم است با اینکه کوکی session سمت SameSite=Lax است: برنامهٔ پیش از لانچ
 * می‌گوید «فرم‌های حساس سخت‌گیرتر شوند» و این گارد لایهٔ دوم است. دو مسیر پذیرش:
 *  ۱) double-submit: هدر `x-csrf-token` با کوکی `csrf_token` یکی باشد
 *     (همان الگوی فروشگاه؛ فروشگاه/ادمین در صورت نیاز هدر را می‌فرستند).
 *  ۲) چک Origin/Referer هم‌مبدأ: مرورگر درخواست cross-site را همیشه با هدر Origin
 *     می‌فرستد و مهاجر نمی‌تواند آن را حذف کند؛ پس اگر Origin آمد و با مبدأهای
 *     مجاز نخواند → ۴۰۳. نبودِ هر دو هدر یعنی درخواست سمت‌سرور/ابزار است
 *     (fetch سروری ادمین، callback درگاه، API-Key) — کوکیِ قربانی را ندارد و تهدید CSRF نیست.
 *
 * مبدأهای مجاز: `CSRF_ALLOWED_ORIGINS` (با کاما) یا در نبودش `CORS_ORIGINS`؛
 * در محیط غیر-production هر origin روی localhost/127.0.0.1 هم مجاز است (توسعه).
 */

export const CSRF_KEY = "ghasedak:csrf";

/** decorator: @RequireCsrf() روی کنترلر یا هندلر حساس */
export function RequireCsrf() {
  return SetMetadata(CSRF_KEY, true);
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** فهرست مبدأهای مجاز از env — هر بار زمان اجرا خوانده می‌شود (تست‌پذیری) */
export function allowedCsrfOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.CSRF_ALLOWED_ORIGINS ?? env.CORS_ORIGINS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

/** مبدأ لوکال (توسعه) — hostname دقیقاً localhost یا 127.0.0.1 با هر پورتی */
export function isLocalOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  } catch {
    return false;
  }
}

/**
 * مبدأ درخواست مجاز است؟ — لیست env یا (فقط در محیط غیر-production) هر origin لوکال؛
 * پورت‌های dev (۳۱۱۱/۳۲۰۰/…) نباید ۴۰۳ بخورند، پس چک localhost به میزبان محدود است نه پورت.
 */
export function originAllowed(origin: string, allowed: string[], env: NodeJS.ProcessEnv = process.env): boolean {
  const clean = origin.trim().replace(/\/+$/, "");
  if (allowed.some((a) => clean === a)) return true;
  return env.NODE_ENV !== "production" && isLocalOrigin(clean);
}

/** خواندن هدر از روی req.headers (در test هم بدون express واقعی کار می‌کند) */
function header(req: Request, name: string): string {
  const v = (req.headers as Record<string, unknown> | undefined)?.[name.toLowerCase()];
  if (Array.isArray(v)) return String(v[0] ?? "");
  return typeof v === "string" ? v : "";
}

/** بررسی double-submit — همان قاعدهٔ فروشگاه (کوکی csrf_token === هدر x-csrf-token) */
function doubleSubmitOk(req: Request): boolean {
  const cookieToken = (req.headers.cookie ?? "").match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] ?? "";
  const headerToken = header(req, "x-csrf-token");
  return cookieToken !== "" && headerToken !== "" && decodeURIComponent(cookieToken) === headerToken;
}

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const needed = this.reflector.getAllAndOverride<boolean>(CSRF_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!needed) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const method = (req.method ?? "GET").toUpperCase();
    if (SAFE_METHODS.has(method)) return true;

    if (doubleSubmitOk(req)) return true;

    const origin = header(req, "origin");
    const referer = header(req, "referer");
    // دقت: || لازم است نه ?? — هدر غایب رشتهٔ خالی می‌دهد و ?? از آن عبور نمی‌کند
    const from = origin || (referer ? rawOrigin(referer) : "");
    // بدون Origin/Referer → درخواست سمت‌سرور/ابزار (مرورگر در cross-site همیشه Origin می‌فرستد)
    if (!from) return true;

    if (originAllowed(from, allowedCsrfOrigins())) return true; // env + localhost در غیر-production

    throw new ForbiddenException({
      code: "CSRF_INVALID",
      message: "درخواست از مبدأ غیرمجاز است؛ صفحه را از خودِ سایت باز کن.",
    });
  }
}

/** استخراج origin از یک URL کامل (Referer) — نامعتبر → رشتهٔ خالی */
function rawOrigin(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "";
  }
}
