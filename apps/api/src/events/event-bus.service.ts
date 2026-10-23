import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { Prisma } from "@prisma/client";
import { backgroundWorkersEnabled } from "../common/background-workers";
import { WebhooksService } from "./webhooks.service";

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

  constructor(
    private readonly prisma: PrismaService,
    // اختیاری: تست‌های موجود EventBus را با یک آرگومان می‌سازند؛ DI عملیاتی همیشه تزریق می‌کند
    private readonly webhooks?: WebhooksService,
  ) {}

  onModuleInit(): void {
    // هر ۵ ثانیه — در production می‌تواند با صف واقعی جایگزین شود (فاز AB)
    // فاز ۱۲ (گام ۵): با GHASEDAK_WORKERS=off خاموش — بوت فقط‌خواندنی/worker جدا
    if (!backgroundWorkersEnabled()) {
      this.logger.log("Background workers disabled (GHASEDAK_WORKERS=off) — EventBus timer not started");
      return;
    }
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
        // فن‌اوت وبهوک خروجی (گام ۱۸) — بعد از هندل موفق؛ شکستش جذب delivery
        // می‌شود و هرگز رویداد دامنه را fail نمی‌کند (بند ۱۱۶).
        await this.webhooks?.dispatchEvent(ev.name, ev.payload as Record<string, unknown>).catch(() => undefined);
        await this.prisma.domainEventOutbox.update({
          where: { id: ev.id },
          data: { state: "DISPATCHED" as never, processedAt: new Date() },
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
      case "OrderDelivered": {
        // دعوت به ثبت نظر بعد از تحویل (فاز نظرات): ردیف SMS صف می‌شود و ارسال واقعی
        // فقط با credential انجام می‌شود (بند ۱۱۱ — بدون credential ردیف با lastError
        // NOT_CONFIGURED در صف می‌ماند؛ هیچ «ارسال شد» جعلی ساخته نمی‌شود و شکست auditable است).
        const orderId = String(payload.orderId ?? "");
        if (!orderId) return;
        const order = await this.prisma.order.findUnique({
          where: { id: orderId },
          select: {
            code: true,
            guestMobile: true,
            items: { take: 1, select: { variant: { select: { product: { select: { slug: true } } } } } },
          },
        });
        if (!order?.guestMobile || !/^09\d{9}$/.test(order.guestMobile)) return;
        const smsSetting = await this.prisma.setting.findUnique({ where: { key: "sms" } });
        const cfg = (smsSetting?.value ?? {}) as { reviewInvite?: boolean };
        if (cfg.reviewInvite === false) return;
        // idempotent per order (بند ۱۱۶) — تحویل فقط یک دعوت می‌فرستد
        const dup = await this.prisma.notification.findFirst({
          where: { channel: "SMS", templateKey: `review-invite:${orderId}` },
        });
        if (dup) return;
        const productSlug = order.items[0]?.variant?.product?.slug ?? null;
        const base = process.env.STOREFRONT_URL ?? "https://lebaszirghasedak.ir";
        await this.prisma.notification.create({
          data: {
            channel: "SMS",
            templateKey: `review-invite:${orderId}`,
            to: order.guestMobile,
            payload: {
              orderCode: order.code,
              link: productSlug ? `${base}/p/${productSlug}` : base,
            },
          },
        });
        this.logger.log(`OrderDelivered: review invite queued for order=${order.code}`);
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
      case "PurchaseInvoiceCreated": {
        // ارسال خودکار فاکتور خرید به تامین‌کننده — بند ۲۷ + بند ۱۱۱:
        // ردیف SupplierInvoiceDelivery در state QUEUED ساخته می‌شود؛ ارسال واقعی فقط با credential
        // (SMTP/Kavenegar). بدون credential ردیف در صف می‌ماند + ADMIN notification — هیچ جعل «ارسال شد».
        const invId = String(payload.invoiceId ?? "");
        if (!invId) return;
        const inv = await this.prisma.purchaseInvoice.findUnique({
          where: { id: invId },
          include: { supplier: { select: { id: true, name: true, email: true, phone: true } } },
        });
        if (!inv) return;
        const autoSetting = await this.prisma.setting.findUnique({ where: { key: "purchasing" } });
        const autoCfg = (autoSetting?.value ?? {}) as { autoSendInvoiceEmail?: boolean; autoSendInvoiceSms?: boolean };
        const wantEmail = autoCfg.autoSendInvoiceEmail === true && !!inv.supplier.email;
        const wantSms = autoCfg.autoSendInvoiceSms === true && !!inv.supplier.phone;
        if (!wantEmail && !wantSms) {
          this.logger.log(`PurchaseInvoiceCreated: auto-send off یا نشانی تامین‌کننده ثبت نشده — skip (${inv.number})`);
          return;
        }
        for (const channel of [wantEmail ? "EMAIL" : null, wantSms ? "SMS" : null]) {
          if (!channel) continue;
          const to = channel === "EMAIL" ? inv.supplier.email! : inv.supplier.phone!;
          // idempotent per invoice+channel (بند ۱۱۶) — فقط یک ردیف تحویل خودکار
          const dup = await this.prisma.supplierInvoiceDelivery.findFirst({
            where: { invoiceId: invId, channel, to },
          });
          if (dup) continue;
          await this.prisma.supplierInvoiceDelivery.create({
            data: {
              invoiceId: invId,
              channel,
              to,
              state: "QUEUED",
              mediaKind: "TEXT",
              lastError: "AUTO_QUEUED: صف خودکار — worker ارسال واقعی با credential",
            },
          });
        }
        await this.notifyAdmin(
          `vendor-invoice-queued:${invId}`,
          `فاکتور خرید ${inv.number} برای تامین‌کننده ${inv.supplier.name} در صف ارسال قرار گرفت`,
          { invoiceId: invId, supplierId: inv.supplier.id },
        );
        this.logger.log(`PurchaseInvoiceCreated: delivery queued for ${inv.number}`);
        return;
      }
      case "PriceChanged": {
        // اطلاع ادمین از تغییر قیمت گروهی/تکی — هر تغییر در PriceHistory هم ledger دارد
        await this.notifyAdmin(
          `price-changed:${String(payload.level)}:${new Date().toISOString().slice(0, 13)}`, // ساعتی idempotent
          `تغییر قیمت سطح ${String(payload.level)} — ${String(payload.count)} کالا`,
          payload,
        );
        this.logger.log(`PriceChanged: level=${String(payload.level)} count=${String(payload.count)}`);
        return;
      }
      // ---------------- فاز ۱۰ — بخش ۸: POS_SALE_COMPLETED (provider-agnostic) ----------------
      case "POS_SALE_COMPLETED": {
        // پیامک مشتری فقط از طریق لایهٔ Notification صف می‌شود؛ provider پیامک (Kavenegar/…) در POS
        // hard-code نیست. بدون credential فروش fail نمی‌شود — ردیف در صف می‌ماند و شکست آن
        // قابل مشاهده/auditable است (الگوی موجود OrderPaid، بند ۱۱۱).
        const mobile = payload.customerMobile ? String(payload.customerMobile) : "";
        if (mobile && /^09\d{9}$/.test(mobile)) {
          const cfgSetting = await this.prisma.setting.findUnique({ where: { key: "sms" } });
          const cfg = (cfgSetting?.value ?? {}) as { posSaleNotify?: boolean };
          if (cfg.posSaleNotify !== false) {
            const dup = await this.prisma.notification.findFirst({
              where: { channel: "SMS", templateKey: `pos-sale-sms:${String(payload.invoiceId)}` },
            });
            if (!dup && process.env.KAVENEGAR_API_KEY) {
              await this.prisma.notification.create({
                data: {
                  channel: "SMS",
                  templateKey: `pos-sale-sms:${String(payload.invoiceId)}`,
                  to: mobile,
                  payload: {
                    invoiceNumber: String(payload.invoiceNumber),
                    amount: String(payload.grandTotal),
                    customerName: payload.customerName ? String(payload.customerName) : null,
                    date: String(payload.createdAt),
                    // لینک امن مشاهده فاکتور — اگر future: token-based؛ فعلاً بدون لینک
                  } as object,
                },
              });
            }
            // بدون credential: هیچ پیام فیک «ارسال‌شده» ساخته نمی‌شود؛ رویداد DISPATCHED می‌شود
          }
        }
        await this.notifyAdmin(
          `pos-sale:${String(payload.invoiceId)}`,
          `فروش POS ${String(payload.invoiceNumber)} — ${String(payload.grandTotal)} تومان`,
          payload,
        );
        this.logger.log(`POS_SALE_COMPLETED: invoice=${String(payload.invoiceNumber)} amount=${String(payload.grandTotal)} sms=${mobile ? (process.env.KAVENEGAR_API_KEY ? "queued" : "no-credential") : "no-mobile"}`);
        return;
      }
      // ---------------- فاز ۹ — Wave 2: مصرف‌کننده‌های دامنهٔ چک ----------------
      case "CheckCleared": {
        await this.notifyAdmin(
          `check-cleared:${String(payload.checkId)}`, // idempotent per check (clear فقط یک‌بار)
          `چک ${payload.direction === "ISSUED" ? "صادره" : "دریافتی"} وصول شد — مبلغ ${String(payload.amount)}`,
          payload,
        );
        this.logger.log(`CheckCleared: check=${String(payload.checkId)}`);
        return;
      }
      case "CheckBounced": {
        await this.notifyAdmin(
          `check-bounced:${String(payload.checkId)}`,
          `⚠️ چک برگشت خورد — مبلغ ${String(payload.amount)}`,
          payload,
        );
        this.logger.log(`CheckBounced: check=${String(payload.checkId)}`);
        return;
      }
      case "CheckCancelled": {
        await this.notifyAdmin(
          `check-cancelled:${String(payload.checkId)}`,
          `چک ابطال شد — مبلغ ${String(payload.amount)}`,
          payload,
        );
        return;
      }
      case "ReminderCreated": {
        // یادآور سررسید چک → زنگ ادمین (کانال واقعی با abstraction Notification — هیچ provider hard-code)
        await this.notifyAdmin(
          `check-reminder:${String(payload.reminderKey)}`, // reminderKey خودش پایدار/idempotent است
          `یادآوری چک — اولویت ${String(payload.priority)}`,
          payload,
        );
        this.logger.log(`ReminderCreated: check=${String(payload.checkId)} kind=${String(payload.kind)}`);
        return;
      }
      default:
        this.logger.debug(`event ${name} — handler ثبت نشده؛ فقط PROCESSED می‌شود`);
    }
  }
}
