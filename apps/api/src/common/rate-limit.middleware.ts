import { Injectable, NestMiddleware } from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";

/**
 * Rate limiter داخلی (بند ۶۸/۷۵) — پنجره ثابت در حافظه برای تک‌نود V1.
 * مسیرهای حساس: برای جلوگیری از brute-force، abuse، و scarcity attacks.
 * در production چندنودی جایگزین Redis می‌شود (فاز AC).
 */
const BUCKETS = new Map<string, { count: number; resetAt: number }>();

const RULES: Array<{ match: RegExp; max: number; windowMs: number }> = [
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
];

@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const path = req.originalUrl ?? req.url ?? "";
    const rule = RULES.find((r) => r.match.test(path));
    if (!rule) {
      next();
      return;
    }
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "unknown";
    const key = `${rule.match.source}:${ip}`;
    const now = Date.now();
    const b = BUCKETS.get(key);
    if (!b || b.resetAt < now) {
      BUCKETS.set(key, { count: 1, resetAt: now + rule.windowMs });
      next();
      return;
    }
    b.count += 1;
    if (b.count > rule.max) {
      res.status(429).json({
        code: "RATE_LIMITED",
        message: "تعداد درخواست‌ها بیش از حد مجاز است؛ کمی بعد تلاش کنید.",
      });
      return;
    }
    next();
  }
}

/** پاک‌سازی دوره‌ای — جلوگیری از رشد حافظه */
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of BUCKETS) if (v.resetAt < now) BUCKETS.delete(k);
}, 300_000).unref();
