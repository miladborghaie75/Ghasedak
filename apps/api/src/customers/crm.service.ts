import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/**
 * CRM + Abandoned Cart — بند ۳۱/۴۰ Master — بدون سیستم موازی:
 * - Customer موجود (mobile unique) = پروفایل؛ آمار از Orders واقعی محاسبه/همگام می‌شود.
 * - Cart موجود (token unique) = سبد سروری؛ تشخیص رهاشدگی = active + items>0 + updatedAt قدیمی.
 * - ConsentRecord موجود (ownerKey+kind unique) = رضایت؛ بند ۴۰: بدون رضایت، هیچ پیام تبلیغی.
 * - Notification/EventBus موجود = کانال اطلاع. هیچ مدل یا state موازی‌ای ساخته نشد.
 */
@Injectable()
export class CrmService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- CRM: مشتریان ----------
  async listCustomers(q: { q?: string; page?: string }) {
    const page = Math.max(1, Number(q.page ?? 1));
    const limit = 30;
    const where = q.q
      ? { OR: [{ mobile: { contains: q.q } }, { name: { contains: q.q } }] }
      : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.customer.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async getCustomer(id: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new NotFoundException({ code: "NOT_FOUND", message: "مشتری یافت نشد." });

    // تاریخچه واقعی — بدون هیچ عدد ساختگی (بند ۱۱۱)
    const [orders, returns, consents, agg] = await Promise.all([
      this.prisma.order.findMany({
        where: { guestMobile: customer.mobile },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, code: true, status: true, paymentStatus: true, total: true, createdAt: true },
      }),
      this.prisma.returnRequest.findMany({
        where: { order: { guestMobile: customer.mobile } },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, number: true, status: true, createdAt: true },
      }),
      this.prisma.consentRecord.findMany({
        where: { ownerKey: customer.mobile },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      this.prisma.order.aggregate({
        where: { guestMobile: customer.mobile, paymentStatus: "PAID" },
        _count: true,
        _sum: { total: true },
      }),
    ]);

    // همگام‌سازی فیلدهای آماری مدل از Orders واقعی (بند ۶: projection، نه source دوم)
    const totalSpent = agg._sum.total ?? 0n;
    if (customer.ordersCount !== agg._count || customer.totalSpent !== totalSpent) {
      const first = await this.prisma.order.findFirst({
        where: { guestMobile: customer.mobile, paymentStatus: "PAID" },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      });
      const last = await this.prisma.order.findFirst({
        where: { guestMobile: customer.mobile, paymentStatus: "PAID" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      await this.prisma.customer.update({
        where: { id },
        data: {
          ordersCount: agg._count,
          totalSpent,
          firstOrderAt: first?.createdAt ?? null,
          lastOrderAt: last?.createdAt ?? null,
        },
      });
    }

    return { customer, orders, returns, consents };
  }

  async updateCustomer(id: string, body: { name?: string; notes?: string; status?: string }) {
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name?.trim() || null;
    if (body.notes !== undefined) data.notes = body.notes?.trim() || null;
    if (body.status && !["active", "blocked"].includes(body.status)) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "وضعیت نامعتبر است." });
    }
    if (body.status) data.status = body.status;
    return this.prisma.customer.update({ where: { id }, data });
  }

  /** رضایت — ConsentRecord موجود با upsert منطقی (granted جدید برنده) */
  async upsertConsent(
    ownerKey: string,
    kind: "SMS_MARKETING" | "EMAIL_MARKETING" | "ANALYTICS" | "COOKIES" | "WHATSAPP",
    granted: boolean,
    source: string,
  ) {
    const existing = await this.prisma.consentRecord.findUnique({
      where: { ownerKey_kind: { ownerKey, kind } },
    });
    if (existing) {
      return this.prisma.consentRecord.update({
        where: { id: existing.id },
        data: { granted, source },
      });
    }
    return this.prisma.consentRecord.create({
      data: { ownerType: "customer", ownerKey, kind, granted, source },
    });
  }

  // ---------- Abandoned Cart (بند ۴۰) ----------
  /**
   * سبد رهاشده = Cart.active با آیتم که updatedAt قدیمی‌تر از delay است.
   * محاسبه زنده از Cart واقعی — هیچ جدول موازی‌ای وجود ندارد.
   */
  async listAbandoned(q: { page?: string; delayMinutes?: string }) {
    const delayMinutes = await this.delayFromSettings(
      q.delayMinutes ? Number(q.delayMinutes) : undefined,
    );
    const cutoff = new Date(Date.now() - delayMinutes * 60_000);
    const page = Math.max(1, Number(q.page ?? 1));
    const limit = 30;
    const where = {
      status: "active",
      updatedAt: { lt: cutoff },
      items: { some: {} },
    };
    const [carts, total] = await this.prisma.$transaction([
      this.prisma.cart.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          items: {
            include: {
              variant: { include: { product: { select: { name: true } } } },
            },
          },
        },
      }),
      this.prisma.cart.count({ where }),
    ]);
    return { items: carts, total, page, limit, delayMinutes };
  }

  /** تنظیم delay از Setting (بند ۵۶: تنظیم واقعی با UI) — پیش‌فرض ۶۰ دقیقه، clamp ۵..۱۴۴۰ */
  private async delayFromSettings(override?: number): Promise<number> {
    if (override != null && Number.isFinite(override) && override >= 5 && override <= 1440) {
      return Math.floor(override);
    }
    const s = await this.prisma.setting.findUnique({ where: { key: "crm.abandonedCart" } });
    const cfg = (s?.value ?? {}) as { delayMinutes?: number };
    const d = Number(cfg.delayMinutes ?? 60);
    return Math.min(1440, Math.max(5, Math.floor(d)));
  }
}
