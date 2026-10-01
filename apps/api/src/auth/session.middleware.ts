import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { AuthService } from "./auth.service";
import type { AdminIdentity } from "./auth.service";

/**
 * هدر X-API-KEY — برای یکپارچه‌سازی‌های سمت‌سرور (اسکریپت‌ها/همکاران خارجی).
 * کلید در apps/api/.env.local نگهداری می‌شود (همان کانال credential — بند ۴۵)؛
 * هویتِ معادل کاربر سیستم (SUPERADMIN) ساخته می‌شود تا گارد permissionها یکسان بماند.
 * مقدار غلط خطا نمی‌دهد — به‌عنوان ناشناس ادامه می‌دهد (endpointهای عمومی).
 */
const API_KEY_HEADER = "x-api-key";

@Injectable()
export class SessionMiddleware implements NestMiddleware {
  constructor(private readonly auth: AuthService) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    (req as unknown as Record<string, unknown>).adminIdentity = await this.auth.identity(req);
    const provided = req.header(API_KEY_HEADER);
    const expected = process.env.GHASEDAK_API_KEY;
    if (expected && provided && provided === expected && !(req as unknown as { adminIdentity?: unknown }).adminIdentity) {
      const sysUserId = await this.auth.systemUserId();
      (req as unknown as Record<string, unknown>).adminIdentity = {
        userId: sysUserId ?? "api-key",
        name: "API Key",
        email: null,
        role: "SUPERADMIN",
        permissions: ["*"] as unknown as string[],
      } as AdminIdentity;
    }
    next();
  }
}
