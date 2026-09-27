import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

/**
 * فاز ۹ — Wave 2: یادآور سررسید چک (STEP 10)
 *
 *  - Schedule ثابت: 7/3/1 روز قبل، روز سررسید، overdue (روزانه بعد از سررسید).
 *  - Timezone Asia/Tehran — مرز «روز» بر اساس تهران محاسبه می‌شود (UTC+3:30 ثابت؛
 *    ایران از ۲۰۲۲ DST ندارد — محاسبه با offset ثابت +03:30 دقیق و ماندگار است).
 *  - idempotencyKey پایدار: `check-due:{checkId}:{kind}:{yyyy-mm-dd تهران}` —
 *    اجرای چندبارهٔ scheduler هرگز ردیف تکراری نمی‌سازد (unique).
 *  - Suppression: چک CLEARED/BOUNCED/RETURNED/CANCELLED → هیچ یادآور آینده‌ای ساخته نمی‌شود؛
 *    ردیف‌های PENDING آینده هم لغو می‌شوند (CANCELLED).
 *  - Consolidation: اگر سیستم down بوده و چند schedule از دست رفته، برای هر چک فقط
 *    «به‌روزترین» ردیف هر رزرو امروز ساخته می‌شود (نه همهٔ روزهای from دست رفته) —
 *    پارامتر missedDays محدود به 14 روز است تا طوفان اعلان رخ ندهد (بند ۱۱۶).
 *  - Provider-agnostic: این سرویس «زمان‌بندی و تصمیم» است؛ ارسال واقعی با Notification
 *    (channel ADMIN) انجام می‌شود — هیچ hard-code SMS/SMTP اینجا نیست (الگوی بند ۵۱).
 */

const TEHRAN_OFFSET_MINUTES = 210; // UTC+03:30 — ایران از ۲۰۲۲ بدون DST

/** تاهو-تاریخ (yyyy-mm-dd) برای یک لحظهٔ UTC */
function tehranDay(d: Date): string {
  const local = new Date(d.getTime() + TEHRAN_OFFSET_MINUTES * 60_000);
  return local.toISOString().slice(0, 10);
}

/** شروع «روز تهران» به‌عنوان لحظهٔ UTC */
function tehranDayStart(d: Date): Date {
  const local = new Date(d.getTime() + TEHRAN_OFFSET_MINUTES * 60_000);
  const localMidnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  return new Date(localMidnight - TEHRAN_OFFSET_MINUTES * 60_000);
}

/** فاصلهٔ تقویمی (روز تهران) بین دو لحظه */
function daysBetween(from: Date, to: Date): number {
  const a = tehranDayStart(from).getTime();
  const b = tehranDayStart(to).getTime();
  return Math.round((b - a) / 86_400_000);
}

type Kind = "D-7" | "D-3" | "D-1" | "DUE" | "OVERDUE";

/** چه یادآوری‌هایی برای فاصلهٔ `days` (تا سررسید؛ منفی = گذشته) لازم است */
function kindsForDays(days: number): Kind[] {
  if (days === 7) return ["D-7"];
  if (days === 3) return ["D-3"];
  if (days === 1) return ["D-1"];
  if (days === 0) return ["DUE"];
  if (days < 0) return ["OVERDUE"]; // هر روز بعد از سررسید — idempotencyKey شامل تاریخ است
  return [];
}

const KIND_TITLE: Record<Kind, string> = {
  "D-7": "سررسید چک — ۷ روز مانده",
  "D-3": "سررسید چک — ۳ روز مانده",
  "D-1": "سررسید چک — ۱ روز مانده",
  DUE: "سررسید چک — امروز",
  OVERDUE: "چک از سررسید گذشته",
};

@Injectable()
export class ReminderService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * پیمایش روزانه — هر چند بار هم صدا زده شود برای همان روز همان خروجی را می‌سازد (idempotent).
   * `now` فقط برای تست تزریق می‌شود.
   */
  async runDaily(opts?: { now?: Date }): Promise<{ created: number; cancelled: number; scanned: number }> {
    const now = opts?.now ?? new Date();
    let created = 0;
    let cancelled = 0;
    let scanned = 0;

    // چک‌های زندهٔ نزدیک سررسید: از ۸ روز قبل تا ۱۴ روز بعد از سررسید (پنجرهٔ consolidation)
    const windowFrom = new Date(tehranDayStart(now).getTime() - 8 * 86_400_000);
    const windowTo = new Date(tehranDayStart(now).getTime() + 15 * 86_400_000);
    const checks = await this.prisma.check.findMany({
      where: { dueDate: { gte: windowFrom, lte: windowTo }, status: { in: ["RECEIVED", "DEPOSITED", "ISSUED", "PRESENTED"] } },
      select: { id: true, number: true, bankName: true, amount: true, dueDate: true, direction: true, customerId: true, supplierId: true },
    });
    scanned = checks.length;

    for (const check of checks) {
      const days = daysBetween(now, check.dueDate);
      const kinds = days >= 0 ? kindsForDays(days) : daysBetween(now, check.dueDate) >= -14 ? ["OVERDUE" as Kind] : [];
      for (const kind of kinds) {
        const day = tehranDay(now);
        const key = `check-due:${check.id}:${kind}:${day}`;
        const exists = await this.prisma.reminder.findUnique({ where: { idempotencyKey: key } });
        if (exists) continue;
        await this.prisma.reminder.create({
          data: {
            title: `${KIND_TITLE[kind]} — چک ${check.number} (${check.bankName}) ${Number(check.amount).toLocaleString("fa-IR")} تومان`,
            dueAt: check.dueDate,
            relatedEntityType: "check",
            relatedEntityId: check.id,
            idempotencyKey: key,
            priority: kind === "OVERDUE" ? 3 : kind === "DUE" ? 2 : 1,
            status: "PENDING",
            channels: ["in_app"],
          },
        });
        // رویداد outbox برای مصرف‌کننده‌ها (ارسال واقعی با abstraction موجود) — payload یکتا → idempotent
        await this.prisma.domainEventOutbox.create({
          data: {
            name: "ReminderCreated",
            payload: { reminderKey: key, checkId: check.id, kind, relatedEntityType: "check", relatedEntityId: check.id, priority: kind === "OVERDUE" ? 3 : kind === "DUE" ? 2 : 1 } as never,
          },
        });
        created += 1;
      }
    }

    // Suppression: چک‌های رسیده به وضعیت پایانی — ردیف‌های PENDING آینده‌شان لغو می‌شود
    const terminalStates: Prisma.EnumCheckStatusFilter = { in: ["CLEARED", "BOUNCED", "RETURNED", "CANCELLED"] };
    const recentTerminal = await this.prisma.check.findMany({
      where: { status: terminalStates, updatedAt: { gte: new Date(now.getTime() - 30 * 86_400_000) } },
      select: { id: true },
    });
    for (const c of recentTerminal) {
      const r = await this.prisma.reminder.updateMany({
        where: { relatedEntityType: "check", relatedEntityId: c.id, status: "PENDING" },
        data: { status: "CANCELLED" },
      });
      cancelled += r.count;
    }

    return { created, cancelled, scanned };
  }
}
