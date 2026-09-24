import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RequirePermission } from "../auth/permissions.guard";
import { CrmService } from "./crm.service";

/**
 * CRM + Abandoned Cart — بند ۳۱/۴۰.
 * permissionها: customers.view / customers.manage (از قبل در seed موجود — بدون permission جدید).
 * همه مسیرهای ادمین audit ندارد به‌صورت خودکار؛ تغییر وضعیت/نوت با AuditLog دستی ثبت می‌شود.
 * Consent عمومی: بند ۴۰/۹۲ — فقط ثبت رضایت، بدون نشت هیچ داده دیگر.
 */
@Controller()
export class CrmController {
  constructor(
    private readonly crm: CrmService,
    private readonly prisma: PrismaService,
  ) {}

  // ---------- ادمین ----------
  @Get("admin/customers")
  @RequirePermission("customers.view")
  list(@Query() q: { q?: string; page?: string }) {
    return this.crm.listCustomers(q);
  }

  @Get("admin/customers/:id")
  @RequirePermission("customers.view")
  detail(@Param("id") id: string) {
    return this.crm.getCustomer(id);
  }

  @Post("admin/customers/:id")
  @RequirePermission("customers.manage")
  async update(
    @Param("id") id: string,
    @Body() body: { name?: string; notes?: string; status?: string },
  ) {
    const before = await this.prisma.customer.findUnique({ where: { id } });
    const updated = await this.crm.updateCustomer(id, body);
    await this.prisma.auditLog.create({
      data: {
        action: "customer.update",
        entity: "Customer",
        entityId: id,
        oldValues: { name: before?.name, status: before?.status, notes: before?.notes } as object,
        newValues: { name: body.name, status: body.status, notes: body.notes } as object,
      },
    });
    return updated;
  }

  @Get("admin/abandoned-carts")
  @RequirePermission("customers.view")
  abandoned(@Query() q: { page?: string; delayMinutes?: string }) {
    return this.crm.listAbandoned(q);
  }

  @Get("admin/crm/settings")
  @RequirePermission("customers.view")
  async settings() {
    const s = await this.prisma.setting.findUnique({ where: { key: "crm.abandonedCart" } });
    const cfg = (s?.value ?? {}) as Record<string, unknown>;
    return {
      enabled: cfg.enabled !== false,
      delayMinutes: Number(cfg.delayMinutes ?? 60),
      consentRequired: cfg.consentRequired !== false,
      maxNotificationsPerCart: Number(cfg.maxNotificationsPerCart ?? 1),
    };
  }

  @Post("admin/crm/settings")
  @RequirePermission("customers.manage")
  async saveSettings(@Body() body: {
    enabled?: boolean;
    delayMinutes?: number;
    consentRequired?: boolean;
    maxNotificationsPerCart?: number;
  }) {
    const value = {
      enabled: body.enabled !== false,
      delayMinutes: Math.min(1440, Math.max(5, Math.floor(Number(body.delayMinutes ?? 60)))),
      consentRequired: body.consentRequired !== false,
      maxNotificationsPerCart: Math.min(3, Math.max(1, Math.floor(Number(body.maxNotificationsPerCart ?? 1)))),
    };
    await this.prisma.setting.upsert({
      where: { key: "crm.abandonedCart" },
      update: { value: value as object },
      create: { key: "crm.abandonedCart", value: value as object },
    });
    await this.prisma.auditLog.create({
      data: {
        action: "crm.settings.update",
        entity: "Setting",
        entityId: "crm.abandonedCart",
        newValues: value as object,
      },
    });
    return value;
  }

  // ---------- عمومی (فروشگاه) — فقط ثبت رضایت (بند ۴۰: consent-aware) ----------
  @Post("public/consent")
  async consent(@Body() body: {
    mobile: string;
    kind: "SMS_MARKETING" | "EMAIL_MARKETING" | "ANALYTICS" | "COOKIES" | "WHATSAPP";
    granted: boolean;
    source?: string;
  }) {
    const kinds = ["SMS_MARKETING", "EMAIL_MARKETING", "ANALYTICS", "COOKIES", "WHATSAPP"] as const;
    if (!/^09\d{9}$/.test(body.mobile ?? "")) {
      return { ok: false, error: { code: "VALIDATION_ERROR", message: "موبایل نامعتبر است." } };
    }
    if (!kinds.includes(body.kind)) {
      return { ok: false, error: { code: "VALIDATION_ERROR", message: "نوع رضایت نامعتبر است." } };
    }
    await this.crm.upsertConsent(body.mobile, body.kind, Boolean(body.granted), body.source ?? "storefront");
    return { ok: true };
  }
}
