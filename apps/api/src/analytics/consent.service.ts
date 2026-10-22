import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export type StorefrontConsentKind = "ANALYTICS" | "COOKIES";

/**
 * ثبت رضایت بازدید ناشناس فروشگاه (گام ۱۵-۱) — جدول ConsentRecord از قبل
 * هست (بک‌اند آماده)؛ این سرویس فقط مسیر guest_session را پر می‌کند.
 *
 * نکتهٔ هم‌ارزی با CRM: upsertConsent در CrmService رکورد customer می‌سازد؛
 * اینجا ownerType=guest_session است چون بازدید آنالیتیکس هنوز حساب ندارد.
 */
@Injectable()
export class ConsentService {
  constructor(private readonly prisma: PrismaService) {}

  /** upsert روی unique([ownerKey, kind]) — تصمیم تازه همیشه برنده است */
  async upsertGuestConsent(
    sessionKey: string,
    kind: StorefrontConsentKind,
    granted: boolean,
    source: string,
  ) {
    const existing = await this.prisma.consentRecord.findUnique({
      where: { ownerKey_kind: { ownerKey: sessionKey, kind } },
    });
    if (existing) {
      return this.prisma.consentRecord.update({
        where: { id: existing.id },
        data: { granted, source },
      });
    }
    return this.prisma.consentRecord.create({
      data: { ownerType: "guest_session", ownerKey: sessionKey, kind, granted, source },
    });
  }
}
