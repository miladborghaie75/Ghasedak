import { createHash } from "node:crypto";
import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { tehranDayStart } from "./tehran-day";

/** قابلیت‌های AI که در سربارِ روزانه مشترک‌اند. */
export type AiCapability = "admin_assistant" | "customer_chat";

export type AiUsageRow = {
  capability: AiCapability;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  costToman: number;
};

export type AiBudgetSnapshot = {
  capToman: number;
  spentToman: number;
  remainingToman: number;
  reservedRequests: number;
  rows: AiUsageRow[];
};

// ---------------------------------------------------------------------------
// پیکربندی واحد — همهٔ اعداد از env خوانده می‌شوند تا منبع نرخ بدون deploy جدید قابل
// اصلاح باشد. پیش‌فرض‌ها محافظه‌کارانه‌اند؛ بدترین حالت، توقفِ زودهنگام است نه واریزِ بی‌حساب.
// ---------------------------------------------------------------------------
/** هزینهٔ تقریبی هر درخواست (تومان) — سهم ثابتِ هر فراخوانی روی سقف. */
const DEFAULT_REQUEST_TOMAN = 250;
/** قیمت تقریبی توکن (تومان به‌ازای هر یک میلیون توکن) روی ارائه‌دهندهٔ پیش‌فرض. */
const DEFAULT_INPUT_TOMAN_PER_MTOK = 1_500_000;
const DEFAULT_OUTPUT_TOMAN_PER_MTOK = 6_000_000;
/** سقفِ سربارِ روزانهٔ کل AI (تومان) در صورت نبودِ تنظیم محیطی. */
const DEFAULT_DAILY_CAP_TOMAN = 20;
/** سقفِ روزانهٔ هر کاربر/نشست برای چت مشتری (تومان نیست؛ شمارِ درخواست). */
const DEFAULT_DAILY_USER_REQUESTS = 50;

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/** کلید کاربر/نشست هرگز خام ذخیره نمی‌شود — فقط هش SHA-256 در ledger می‌رود. */
export function hashUserKey(userKey: string): string {
  return createHash("sha256").update(userKey).digest("hex");
}

/** برآوردِ سربار (تومان) از شمارش‌های ثبت‌شده؛ تقریبِ محافظه‌کارانه و فقط برای مهارِ هزینه. */
export function estimateCostToman(
  row: { requests: number; inputTokens: number; outputTokens: number },
  rates: { requestToman: number; inputPerMtok: number; outputPerMtok: number },
): number {
  return (
    row.requests * rates.requestToman +
    (row.inputTokens * rates.inputPerMtok) / 1_000_000 +
    (row.outputTokens * rates.outputPerMtok) / 1_000_000
  );
}

/**
 * سقفِ سربارِ روزانهٔ AI و دفترِ مصرفِ روزانه (AiUsageDay) — همه در ذخیره‌ساز مشترک DB
 * تا بین چند نمونهٔ API و پس از restart معتبر بماند. «روز» با مرزِ تقویمِ تهران محاسبه
 * می‌شود؛ هزینه با سقفِ کل (نه سقفِ جدا برای هر قابلیت) مقایسه می‌شود.
 *
 * گیت‌های پیش از تماس پولی fail-closed هستند: خطای DB یعنی ردِ درخواست (503)، نه عبور.
 * رزرو اتمیک (`reserveRequest`) پیش از تماس پولی و تسویه (`recordUsage`) با مصرف واقعی
 * انجام می‌شود؛ رزروی که به پاسخ نرسد با `releaseReservation` آزاد می‌شود.
 */
@Injectable()
export class AiBudgetService {
  private readonly logger = new Logger(AiBudgetService.name);
  /** آخرین پاک‌سازی ردیف‌های روزهای گذشته — هر ۶ ساعت یک‌بار کافی است. */
  private lastSweepAt = 0;

  constructor(private readonly prisma: PrismaService) {}

  get dailyCapToman(): number {
    return positiveInt(process.env.AI_DAILY_CAP_TOMANS, DEFAULT_DAILY_CAP_TOMAN);
  }

  get dailyUserRequestCap(): number {
    return positiveInt(process.env.AI_DAILY_USER_REQUESTS, DEFAULT_DAILY_USER_REQUESTS);
  }

  /** نرخ‌های برآورد هزینه — با پیکربندی واحد از env قابل تنظیم. */
  private get rates() {
    return {
      requestToman: positiveInt(process.env.AI_REQUEST_TOMAN, DEFAULT_REQUEST_TOMAN),
      inputPerMtok: positiveInt(process.env.AI_INPUT_TOMAN_PER_MTOK, DEFAULT_INPUT_TOMAN_PER_MTOK),
      outputPerMtok: positiveInt(process.env.AI_OUTPUT_TOMAN_PER_MTOK, DEFAULT_OUTPUT_TOMAN_PER_MTOK),
    };
  }

  private failClosed(): never {
    throw new HttpException(
      {
        code: "AI_BUDGET_UNAVAILABLE",
        message: "دستیار موقتاً در دسترس نیست؛ کمی بعد دوباره تلاش کن.",
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  private capReached(): never {
    throw new HttpException(
      {
        code: "AI_DAILY_CAP_REACHED",
        message: "سقفِ هزینهٔ روزانهٔ هوش مصنوعی پر شده است؛ فردا دوباره تلاش کن.",
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /**
   * پیش از فراخوانیِ ارائه‌دهنده: اگر سربارِ امروز (مصرف + رزروهای در جریانِ **همهٔ
   * قابلیت‌ها**) به سقف رسیده باشد، 429 می‌دهد. خطای DB fail-closed است و 503 می‌دهد.
   */
  async assertWithinDailyCap(capability: AiCapability): Promise<void> {
    const day = tehranDayStart();
    let rows: Array<{ requests: number; inputTokens: number; outputTokens: number; reservedRequests: number }> | null;
    try {
      rows = await this.prisma.aiUsageDay.findMany({
        where: { day },
        select: { requests: true, inputTokens: true, outputTokens: true, reservedRequests: true },
      });
    } catch (error) {
      this.logger.error(
        `AI budget ledger unavailable (capability=${capability}); failing closed`,
        error instanceof Error ? error.message : undefined,
      );
      this.failClosed();
    }
    // سقفِ کل مشترک است: جمعِ همهٔ قابلیت‌های امروز با سقفِ واحد مقایسه می‌شود —
    // نه سقفِ جدا برای هر قابلیت (وگرنه دو قابلیت با هم دو برابر سقف خرج می‌کردند).
    const spent = (rows ?? []).reduce((sum, row) => sum + estimateCostToman(row, this.rates), 0);
    // هر رزروِ در جریان دست‌کم هزینهٔ ثابتِ یک درخواست را از سقفِ کل کم می‌کند.
    const reserved = (rows ?? []).reduce((sum, row) => sum + (row.reservedRequests ?? 0), 0) * this.rates.requestToman;
    if (spent + reserved >= this.dailyCapToman) this.capReached();
  }

  /**
   * رزروِ اتمیکِ یک فراخوانی پولی پیش از تماسِ ارائه‌دهنده — برای هر قابلیت با تراکنشِ
   * مستقل، اما گیتِ سقف جمعِ همهٔ قابلیت‌های امروز را می‌سنجد (سقف مشترک). ردیفِ همین
   * قابلیت داخل تراکنش قفل می‌شود، پس رزروهای هم‌زمانِ یک قابلیت سریالی‌اند و مجموعشان
   * هرگز از سقف نمی‌گذرد. در صورت رسیدن به سقف، رزروی ثبت نمی‌شود و 429 می‌دهد؛ خطای DB
   * هم fail-closed است.
   */
  async reserveRequest(capability: AiCapability): Promise<void> {
    const day = tehranDayStart();
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.aiUsageDay.upsert({
          where: { day_capability: { day, capability } },
          create: { day, capability, reservedRequests: 1 },
          update: { reservedRequests: { increment: 1 } },
        });
        // جمعِ سقف مشترک است — همهٔ قابلیت‌های امروز، نه فقط همین یکی.
        const rows = await tx.aiUsageDay.findMany({
          where: { day },
          select: { requests: true, inputTokens: true, outputTokens: true, reservedRequests: true },
        });
        const spent = rows.reduce((sum, row) => sum + estimateCostToman(row, this.rates), 0);
        // رزروهای در جریان هم دست‌کم هزینهٔ ثابتِ یک درخواست از سقف می‌گیرند؛ شمارشِ
        // آن‌ها در همین تراکنش یعنی رزروهای هم‌زمانِ یک قابلیت از سقف عبور نمی‌کنند.
        // (رزروی که هم‌زمان روی قابلیتِ دیگر ثبت شود ممکن است یک درخواست بیشتر اجازه دهد؛
        //  دقتِ مرزی در آن حالت به اندازهٔ هزینهٔ ثابتِ یک درخواست است.)
        const reserved = rows.reduce((sum, row) => sum + (row.reservedRequests ?? 0), 0) * this.rates.requestToman;
        if (spent + reserved >= this.dailyCapToman) {
          // رزروی که به سقف نمی‌رسد، بی‌درنگ آزاد می‌شود تا سقفِ کل محفوظ بماند.
          await tx.aiUsageDay.update({
            where: { day_capability: { day, capability } },
            data: { reservedRequests: { decrement: 1 } },
          });
          this.capReached();
        }
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(
        `AI budget reserve failed (capability=${capability}); failing closed`,
        error instanceof Error ? error.message : undefined,
      );
      this.failClosed();
    }
  }

  /** آزادسازی رزروی که به تماس پولی نرسید (خطای قبل از provider). */
  async releaseReservation(capability: AiCapability): Promise<void> {
    const day = tehranDayStart();
    try {
      await this.prisma.aiUsageDay.update({
        where: { day_capability: { day, capability } },
        data: { reservedRequests: { decrement: 1 } },
      });
    } catch (error) {
      // رزرو ممکن است هرگز ثبت نشده باشد؛ نبود ردیف یا منفی‌شدن خطای بحرانی نیست.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2025") {
        this.logger.warn(
          `AI budget release failed (capability=${capability})`,
          error instanceof Error ? error.message : undefined,
        );
      }
    }
  }

  /**
   * سقفِ روزانهٔ هر کاربر/نشست — در ذخیره‌ساز مشترک (AiUserDay) شمرده می‌شود تا بین
   * چند نمونهٔ API و پس از restart برقرار بماند. کلید فقط به‌صورت هش SHA-256 ذخیره
   * می‌شود؛ هیچ IP خام یا شناسهٔ کاربری در ledger ثبت نمی‌شود. درخواست ردشده سهمی
   * مصرف نمی‌کند (شمارنده برمی‌گردد).
   */
  async assertWithinUserCap(userKey: string): Promise<void> {
    const day = tehranDayStart();
    const userKeyHash = hashUserKey(userKey);
    const cap = this.dailyUserRequestCap;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const row = await this.prisma.$transaction(async (tx) => {
          const upserted = await tx.aiUserDay.upsert({
            where: { day_userKeyHash: { day, userKeyHash } },
            create: { day, userKeyHash, requests: 1 },
            update: { requests: { increment: 1 } },
            select: { requests: true },
          });
          if (upserted.requests > cap) {
            // درخواستِ ردشده رزرو نمی‌کند؛ شمارش را برمی‌گردانیم تا فقط پاسخ‌های واقعی بشمارند.
            await tx.aiUserDay.update({
              where: { day_userKeyHash: { day, userKeyHash } },
              data: { requests: { decrement: 1 } },
            });
          }
          return upserted;
        });
        if (row.requests > cap) {
          throw new HttpException(
            {
              code: "AI_USER_CAP_REACHED",
              message: "تعداد پیام‌های امروز تو به سقف رسیده؛ فردا دوباره با ما گپ بزن.",
            },
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
        this.sweepOldRows(day);
        return;
      } catch (error) {
        // دو تراکنش هم‌زمان روی ردیفِ تازه ممکن است P2002 بگیرند؛ یک‌بار تلاش مجدد کافی است.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && attempt === 0) continue;
        if (error instanceof HttpException) throw error;
        // fail-closed: بدون تأییدِ دفتر مشترک، درخواست پولی انجام نمی‌شود.
        this.logger.error(
          "AI user-cap ledger unavailable; failing closed",
          error instanceof Error ? error.message : undefined,
        );
        this.failClosed();
      }
    }
  }

  /** ردیف‌های روزهای گذشته فقط امروز معتبرند؛ پاک‌سازی کوت‌شده هر ۶ ساعت. */
  private sweepOldRows(today: Date): void {
    const now = Date.now();
    if (now - this.lastSweepAt < 6 * 60 * 60_000) return;
    this.lastSweepAt = now;
    void this.prisma.aiUserDay.deleteMany({ where: { day: { lt: today } } }).catch(() => undefined);
  }

  /**
   * تسویهٔ پس از پاسخِ ارائه‌دهنده: مصرف واقعی ثبت و رزروِ در جریان (در صورت وجود)
   * آزاد می‌شود. خطای ledger مسیرِ پاسخ را نمی‌شکند ولی در لاگ ساخت‌یافته ثبت می‌شود
   * تا «مصرف صفر» موفقیتِ کاذب شمرده نشود.
   */
  async recordUsage(
    capability: AiCapability,
    usage: { inputTokens?: number; outputTokens?: number } = {},
  ): Promise<void> {
    try {
      const day = tehranDayStart();
      const inputTokens = Math.max(0, Math.round(usage.inputTokens ?? 0));
      const outputTokens = Math.max(0, Math.round(usage.outputTokens ?? 0));
      await this.prisma.aiUsageDay.upsert({
        where: { day_capability: { day, capability } },
        create: {
          day,
          capability,
          requests: 1,
          inputTokens,
          outputTokens,
        },
        update: {
          requests: { increment: 1 },
          inputTokens: { increment: inputTokens },
          outputTokens: { increment: outputTokens },
        },
        select: { requests: true },
      });
      try {
        // بدون رزرو (مسیر قدیمی consumers) نبود ردیف/منفی‌شدن مجاز است.
        await this.prisma.aiUsageDay.update({
          where: { day_capability: { day, capability } },
          data: { reservedRequests: { decrement: 1 } },
        });
      } catch {
        /* تسویهٔ رزرو اختیاری است؛ شمارش مصرف بالا ثبت شده است. */
      }
    } catch (error) {
      this.logger.error(
        `AI usage ledger write failed (capability=${capability}) — spend is under-counted`,
        error instanceof Error ? error.message : undefined,
      );
    }
  }

  /** تصویرِ امروز برای نمایش به ادمین (تنظیمات قابلیت‌ها / گزارش). */
  async todaySnapshot(): Promise<AiBudgetSnapshot> {
    const day = tehranDayStart();
    const rows = await this.prisma.aiUsageDay.findMany({
      where: { day },
      orderBy: { capability: "asc" },
    });
    const mapped = rows.map((row) => ({
      capability: row.capability as AiCapability,
      requests: row.requests,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      costToman: estimateCostToman(row, this.rates),
    }));
    const spentToman = mapped.reduce((sum, row) => sum + row.costToman, 0);
    return {
      capToman: this.dailyCapToman,
      spentToman,
      remainingToman: Math.max(0, this.dailyCapToman - spentToman),
      reservedRequests: rows.reduce((sum, row) => sum + row.reservedRequests, 0),
      rows: mapped,
    };
  }
}
