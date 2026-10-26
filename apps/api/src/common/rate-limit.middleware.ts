import { Injectable, NestMiddleware, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Rate limiter (بند ۶۸/۷۵) — گام ۲۴: پنجرهٔ ثابت در ذخیره‌ساز مشترک DB
 * (RateLimitWindow) تا بین چند نمونهٔ API و پس از restart برقرار بماند.
 * کلید هرگز به‌صورت خام ذخیره نمی‌شود: هش SHA-256ِ (شناسهٔ قانون + کلید کلاینت).
 *
 * فال‌بک: اگر DB در دسترس نباشد، محدودکننده به حافظهٔ همین فرایند برمی‌گردد
 * (دسترس‌پذیری API فدای شمارش مشترک نمی‌شود) و برای observability لاگ می‌شود.
 * در حالت فال‌بک، محدودیت بین نمونه‌ها نابرابر است؛ پایش باید هشدار دهد.
 */
export const RULES: Array<{ match: RegExp; max: number; windowMs: number }> = [
  // Auth routes - strict limits to prevent brute force
  { match: /\/auth\/login$/, max: 5, windowMs: 60_000 }, // 5/min per IP (login is most critical)
  { match: /\/auth\/logout$/, max: 10, windowMs: 60_000 }, // 10/min per IP
  { match: /\/auth\/me$/, max: 30, windowMs: 60_000 }, // 30/min per IP (less critical)

  // Order routes - protect order creation and modification
  { match: /\/orders\/checkout$/, max: 10, windowMs: 60_000 }, // 10/min per IP (order creation is critical)
  { match: /\/orders\/quote\/coupon$/, max: 20, windowMs: 60_000 }, // 20/min per IP (quote is less critical)
  { match: /\/orders\/.+$/, max: 30, windowMs: 60_000 }, // 30/min per IP for other order routes (cancel, edit, etc.)

  // Payment routes - protect payment initiation and verification
  { match: /\/payments\/start$/, max: 5, windowMs: 60_000 }, // 5/min per IP (payment initiation is critical)
  { match: /\/payments\/verify\/.+$/, max: 10, windowMs: 60_000 }, // 10/min per IP (verification)
  { match: /\/payments\/methods$/, max: 30, windowMs: 60_000 }, // 30/min per IP (methods list)
  { match: /\/payments\/admin\/list$/, max: 20, windowMs: 60_000 }, // 20/min per IP (admin list)
  { match: /\/payments\/callback\/.+$/, max: 30, windowMs: 60_000 }, // 30/min per IP (callback from providers)
  { match: /\/payments\/.+$/, max: 20, windowMs: 60_000 }, // 20/min per IP for other payment routes

  // Review routes (گام ۱۱ — بند ۴۱) — OTP/submit حساس به اسپم است
  { match: /\/reviews\/otp\/request$/, max: 3, windowMs: 60_000 }, // 3/min per IP (پیامک واقعی — گران)
  { match: /\/reviews\/otp\/verify$/, max: 10, windowMs: 60_000 }, // 10/min per IP
  { match: /\/reviews\/submit$/, max: 5, windowMs: 300_000 }, // 5/5min per IP
  { match: /\/reviews\/product\/.+$/, max: 60, windowMs: 60_000 }, // 60/min per IP (نمایش عمومی)

  // Wishlist routes (گام ۱۱ — بند ۴۲) — تغییر علاقه‌مندی مهمان
  { match: /\/wishlist\/items(\/.+)?$/, max: 60, windowMs: 60_000 }, // 60/min per IP (toggle سبک)

  // Analytics public (گام ۱۵-۶) — ping بازدید؛ سقف شل تا ناوبری طبیعی سالم بماند
  { match: /\/analytics\/public\/visit$/, max: 120, windowMs: 60_000 }, // 120/min per IP

  // Admin assistant (step 18-2) — AI responses are paid, keep a separate budget per IP
  { match: /\/admin\/assistant\/query$/, max: 20, windowMs: 60_000 }, // 20/min per IP

  // Public customer chat; keep paid AI requests bounded per client IP.
  { match: /\/customer-chat$/, max: 20, windowMs: 60_000 },
];

/** کلاینتِ هر درخواست — هیچ IP خامی ذخیره نمی‌شود؛ فقط هش می‌شود. (export برای تست) */
export function clientKeyOf(req: Request): string {
  // اعتماد به header فقط وقتی مجاز است که استقرار صریحاً پراکسیِ قابل اعتماد را اعلام
  // کرده باشد (TRUST_PROXY=1 یا TRUST_PROXY_HOPS=n). مقدار «اولین» ورودیِ XFF ساختِ
  // خود کلاینت است و ممنوع؛ مقدارِ معتبر را نزدیک‌ترین پراکسیِ قابل اعتماد اضافه می‌کند،
  // پس از راستِ فهرست شمرده می‌شود.
  const hops = positiveInt(process.env.TRUST_PROXY_HOPS, process.env.TRUST_PROXY === "1" ? 1 : 0);
  if (hops > 0) {
    const forwarded = (req.headers["x-forwarded-for"] as string | undefined)?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
    const trusted = forwarded[Math.max(0, forwarded.length - hops)];
    if (trusted) return trusted;
  }
  return req.ip || "unknown";
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function windowKeyHash(ruleId: string, clientKey: string): string {
  return createHash("sha256").update(`${ruleId}|${clientKey}`).digest("hex");
}

/** ابتدای پنجرهٔ ثابت، هم‌راستا با epoch — همهٔ نمونه‌ها پنجرهٔ یکسان می‌بینند. */
function windowStartFor(windowMs: number, now: number): Date {
  return new Date(Math.floor(now / windowMs) * windowMs);
}

const FALLBACK_BUCKETS = new Map<string, { count: number; resetAt: number }>();

/** پاک‌سازی دوره‌ای فال‌بک — جلوگیری از رشد حافظه */
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of FALLBACK_BUCKETS) if (v.resetAt < now) FALLBACK_BUCKETS.delete(k);
}, 300_000).unref();

@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RateLimitMiddleware.name);
  private dbHealthy = true;

  constructor(private readonly prisma: PrismaService) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const path = req.originalUrl ?? req.url ?? "";
    const ruleIndex = RULES.findIndex((r) => r.match.test(path));
    if (ruleIndex < 0) {
      next();
      return;
    }
    const rule = RULES[ruleIndex];
    const now = Date.now();
    const windowStart = windowStartFor(rule.windowMs, now);
    const windowKey = windowKeyHash(`rule${ruleIndex}`, clientKeyOf(req));

    let count: number;
    try {
      // شمارش اتمیک مشترک: ردیف پنجره را می‌سازد و count جدید را برمی‌گرداند.
      const result = await this.prisma.rateLimitWindow.upsert({
        where: { windowKey_windowStart: { windowKey, windowStart } },
        create: { windowKey, windowStart, count: 1 },
        update: { count: { increment: 1 } },
        select: { count: true },
      });
      count = result.count;
      this.dbHealthy = true;
      // ردیف‌های پنجرهٔ گذشته بی‌ارزش‌اند؛ هر ۱۰ دقیقه یک‌بار پاک می‌شوند.
      await this.sweepOldWindows(now);
    } catch (error) {
      if (this.dbHealthy) {
        this.logger.warn(
          "Rate-limit shared store unavailable; falling back to per-instance memory",
          error instanceof Error ? error.message : undefined,
        );
      }
      this.dbHealthy = false;
      count = this.fallbackCount(windowKey, now, rule.windowMs);
    }

    if (count > rule.max) {
      res.status(429).json({
        code: "RATE_LIMITED",
        message: "تعداد درخواست‌ها بیش از حد مجاز است؛ کمی بعد تلاش کنید.",
      });
      return;
    }
    next();
  }

  private fallbackCount(key: string, now: number, windowMs: number): number {
    const b = FALLBACK_BUCKETS.get(key);
    if (!b || b.resetAt < now) {
      FALLBACK_BUCKETS.set(key, { count: 1, resetAt: now + windowMs });
      return 1;
    }
    b.count += 1;
    return b.count;
  }

  private lastSweepAt = 0;

  /** پاک‌سازی کوت‌شدهٔ ردیف‌های پنجره‌های تمام‌شده (هر ۱۰ دقیقه، در پس‌زمینه). */
  private async sweepOldWindows(now: number): Promise<void> {
    if (now - this.lastSweepAt < 10 * 60_000) return;
    this.lastSweepAt = now;
    void this.prisma.rateLimitWindow.deleteMany({ where: { windowStart: { lt: new Date(now - 2 * 60_000) } } }).catch(() => undefined);
  }
}
