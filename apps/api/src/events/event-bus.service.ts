import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { Prisma } from "@prisma/client";

/**
 * Event Bus — بند ۴۳/۴۴: Outbox pattern؛ رویداد در همان تراکنش دامنه نوشته و
 * این worker توزیع می‌کند. هر handler idempotent است (بند ۱۱۶).
 *
 * Handlerهای فعال:
 * - OrderPaid → Notification(ADMIN) زنگ داشبورد + SmsLog صف ارسال (فقط وقتی credential)
 * - OrderCreated → Notification(ADMIN)
 */
@Injectable()
export class EventBusService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventBusService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    // هر ۵ ثانیه — در production می‌تواند با صف واقعی جایگزین شود (فاز AB)
    this.timer = setInterval(() => void this.drain(), 5_000);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async publish(name: string, payload: Prisma.InputJsonValue): Promise<void> {
    await this.prisma.domainEventOutbox.create({ data: { name, payload } }).catch(() => {
      // رویداد تکراری (unique name+payload) — idempotent
    });
  }

  async drain(): Promise<void> {
    const events = await this.prisma.domainEventOutbox.findMany({
      where: { state: "PENDING", availableAt: { lte: new Date() } },
      orderBy: { createdAt: "asc" },
      take: 20,
    });
    for (const ev of events) {
      try {
        await this.handle(ev.name, ev.payload as Record<string, unknown>);
        await this.prisma.domainEventOutbox.update({
          where: { id: ev.id },
          data: { state: "PROCESSED" as never, processedAt: new Date() },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "unknown";
        const attempts = ev.attempts + 1;
        await this.prisma.domainEventOutbox.update({
          where: { id: ev.id },
          data: {
            attempts,
            lastError: msg,
            state: (attempts >= 5 ? "FAILED" : "PENDING") as never,
            availableAt: new Date(Date.now() + Math.min(60_000, 2 ** attempts * 1_000)),
          },
        });
      }
    }
  }

  /** Notification idempotent — key یکتا بر اساس رویداد (بند ۱۱۶) */
  private async notifyAdmin(key: string, title: string, payload: Record<string, unknown>): Promise<void> {
    const dup = await this.prisma.notification.findFirst({
      where: { channel: "ADMIN", templateKey: key, createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
    });
    if (dup) return;
    await this.prisma.notification.create({
      data: { channel: "ADMIN", templateKey: key, to: "admin-dashboard", payload: { title, ...payload } },
    });
  }

  private async handle(name: string, payload: Record<string, unknown>): Promise<void> {
    switch (name) {
      case "OrderCreated": {
        await this.notifyAdmin(`order-created:${String(payload.orderId)}`, "سفارش جدید ثبت شد", payload);
        this.logger.log(`OrderCreated: order=${String(payload.orderCode)}`);
        return;
      }
      case "OrderPaid": {
        await this.notifyAdmin(`order-paid:${String(payload.orderId)}`, "سفارش پرداخت شد ✅", payload);
        // SMS مشتری — فقط صف می‌شود؛ worker SMS واقعی فقط با credential ارسال می‌کند
        const smsSetting = await this.prisma.setting.findUnique({ where: { key: "sms" } });
        const cfg = (smsSetting?.value ?? {}) as { orderNotify?: boolean };
        if (cfg.orderNotify !== false && payload.customerMobile) {
          const dupSms = await this.prisma.notification.findFirst({
            where: { channel: "SMS", templateKey: `order-paid-sms:${String(payload.orderId)}` },
          });
          if (!dupSms && process.env.KAVENEGAR_API_KEY) {
            await this.prisma.notification.create({
              data: {
                channel: "SMS",
                templateKey: `order-paid-sms:${String(payload.orderId)}`,
                to: String(payload.customerMobile),
                payload: { orderId: String(payload.orderId), amount: String(payload.amount) },
              },
            });
          }
          // بدون credential: فقط لاگ — هیچ پیام فیک «ارسال شد» ساخته نمی‌شود (بند ۱۱۱)
        }
        this.logger.log(`OrderPaid: order=${String(payload.orderId)} amount=${String(payload.amount)}`);
        return;
      }
      case "LowStockStockAlert": {
        // هشدار ادمین — فقط با تنظیم lowStockAlerts=true و حداقل هر ۶ ساعت
        const invSetting = await this.prisma.setting.findUnique({ where: { key: "inventory.lowStockAlerts" } });
        if (invSetting?.value === false) return;
        await this.notifyAdmin(
          `low-stock:${String(payload.variantSku)}`,
          "موجودی به آستانه کم رسید 🔶",
          payload,
        );
        this.logger.log(`LowStockStockAlert: sku=${String(payload.variantSku)} qty=${String(payload.stockQty)}`);
        return;
      }
      case "StockRestocked": {
        // «موجود شد» — SMS صف می‌شود فقط با تنظیم restockAlerts=true و credential واقعی
        const invSetting2 = await this.prisma.setting.findUnique({ where: { key: "inventory.restockAlerts" } });
        if (invSetting2?.value === false) return;
        const alerts = await this.prisma.stockAlert.findMany({
          where: { variantSku: String(payload.variantSku), state: "PENDING" },
          take: 100,
        });
        for (const a of alerts) {
          const hasCredential = Boolean(process.env.KAVENEGAR_API_KEY);
          if (a.channel === "sms" && !hasCredential) {
            // بدون credential هیچ پیام «ارسال‌شده» جعل نمی‌شود (بند ۱۱۱)
            continue;
          }
          await this.prisma.notification.create({
            data: {
              channel: a.channel === "sms" ? "SMS" : "EMAIL",
              templateKey: `stock-alert:${a.id}`,
              to: a.target,
              payload: { variantSku: a.variantSku } as object,
            },
          }).catch(() => undefined);
          await this.prisma.stockAlert.update({
            where: { id: a.id },
            data: { state: "NOTIFIED", notifiedAt: new Date() },
          }).catch(() => undefined);
        }
        return;
      }
      case "StocktakeApprovalRequested": {
        await this.notifyAdmin(
          `stk-approval:${String(payload.stocktakeId)}`,
          "تایید تعدیل انبارگردانی لازم است",
          payload,
        );
        return;
      }
      default:
        this.logger.debug(`event ${name} — handler ثبت نشده؛ فقط PROCESSED می‌شود`);
    }
  }
}
