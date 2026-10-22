import { Injectable, Logger } from "@nestjs/common";
import { isBotUa } from "@ghasedak/contracts";
import { PrismaService } from "../prisma/prisma.service";

/**
 * شمارش بازدید فروشگاه (گام ۱۵-۶) — first-party، جمع‌شده در روز.
 *
 * چرا جدول تجمیعی و نه رویداد خام: بازدید روزانه فقط دو عدد می‌خواهد
 * (بازدید صفحه، بازدیدکنندهٔ یکتا). رویداد خامِ هر ناوبری جدولی بی‌انتها
 * می‌ساخت که هیچ‌وقت پاک نمی‌شود؛ تجمیع روزانه هم کوئری داشبورد را O(روزها)
 * می‌کند هم ردپای حریم خصوصی را حداقلی نگه می‌دارد (نامت، مسیر، بدون PII).
 *
 * شمارش همیشه‌روشن است (تصمیم تازهٔ D-5، ۲۰۲۶-۱۰-۱۸): رضایت دیگر دروازهٔ
 * شمارش نیست — داده تجمیعی و بدون PII است و قانون ایران برای شمارشِ first-party
 * بنر نمی‌خواهد؛ رضایت فقط اسکریپت Google Analytics را آزاد می‌کند (ConsentGate).
 *
 * «روز» به وقت تهران است — همان الگوی DashboardController (آفست ثابت +۳:۳۰،
 * ایران ساعت تابستانی ندارد). مرز روز به‌صورت UTC ذخیره می‌شود.
 */

const TEHRAN_OFFSET_MS = 3.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** پنجرهٔ یکتاییِ بازدید (D-6) — همان مقدار سمت کلاینت (analytics.ts) */
const VIEW_WINDOW_MS = 30 * 60 * 1000;
/** عمر ردیف‌های پنجره/نشست — بعد از این فقط تجمیع DailyVisit می‌ماند */
const PATH_RETENTION_DAYS = 2;
/** احتمال اجرای sweep پاک‌سازی در هر پینگ — آماری، سبک و بدون بار اضافه */
const PRUNE_CHANCE = 0.02;

/** آغاز «امروز» به وقت تهران، به‌صورت UTC */
function tehranDayStart(now = new Date()): Date {
  const shifted = new Date(now.getTime() + TEHRAN_OFFSET_MS);
  return new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - TEHRAN_OFFSET_MS,
  );
}

/** کلید روز (YYYY-MM-DD) برای یک مرز روزِ UTC */
function dayKey(day: Date): string {
  return new Date(day.getTime() + TEHRAN_OFFSET_MS).toISOString().slice(0, 10);
}

/** رشتهٔ YYYY-MM-DD (روز تهران) → مرز UTC آن روز */
function parseDayKey(key: string): Date {
  return new Date(`${key}T00:00:00+03:30`);
}

export interface VisitPoint {
  day: string; // YYYY-MM-DD به وقت تهران
  views: number;
  sessions: number;
}

export interface VisitBucket {
  views: number;
  sessions: number;
}

export interface VisitsSummary {
  range: { from: string; to: string };
  points: VisitPoint[];
  totals: VisitBucket;
  quick: {
    today: VisitBucket;
    week: VisitBucket; // از شنبه (آغاز هفتهٔ ایران) تا امروز
    month: VisitBucket; // از آغاز ماه میلادی (به وقت تهران)
    year: VisitBucket; // از آغاز سال میلادی (به وقت تهران)
  };
}

@Injectable()
export class VisitsService {
  private readonly logger = new Logger(VisitsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * شمارش یک بازدید صفحه. هرگز throw نمی‌کند — آمار نباید مسیر خرید را بشکند.
   * همیشه‌روشن (D-5): رضایت فقط دروازهٔ GA4 است، نه این جدول.
   *
   * مقاوم در برابر دوباره‌شماری (D-6):
   *  - بات/خزنده (user-agent معروف) اصلاً شمرده نمی‌شود؛
   *  - هر (روز، نشست، مسیر) در پنجرهٔ ۳۰ دقیقه فقط یک‌بار views می‌گیرد —
   *    F5 و برگشت سریع به همان صفحه بی‌اثرند (کلاینت هم همین پنجره را
   *    sessionStorage می‌گیرد، ولی سرور مرز حقیقت است).
   * counted=true یعنی این پینگ دست‌کم یکی از دو شمارنده را جابه‌جا کرد.
   */
  async recordVisit(
    sessionKey: string,
    path: string,
    ua?: string,
  ): Promise<{ counted: boolean; reason?: string }> {
    try {
      // خزنده/ابزار معروف شمرده نمی‌شود؛ UA غایب (فراخوانی داخلی/تست) بات نیست
      if (ua !== undefined && isBotUa(ua)) {
        return { counted: false, reason: "BOT" };
      }

      const day = tehranDayStart();
      let changed = false;

      await this.prisma.$transaction(async (tx) => {
        // نشستِ این روز: createMany + skipDuplicates یعنی ON CONFLICT DO
        // NOTHING اتمیک و بدون race؛ و برخلاف catchِ P2002 داخل تراکنش،
        // تراکنش را abort نمی‌کند (در Postgres خطای داخل $transaction تعاملی
        // کل تراکنش را می‌سوزاند و کوئری بعدی 25P02 می‌گیرد).
        // count=1 → نشستِ تازهٔ امروز (باید sessions هم بشمارد)؛ count=0 → قبلاً بوده.
        const createdSessions = await tx.dailyVisitSession.createMany({
          data: [{ day, sessionKey }],
          skipDuplicates: true,
        });
        const newSession = createdSessions.count > 0;

        // پنجرهٔ ۳۰ دقیقه‌ایِ views — دو کوئری اتمیک، بدون findUnique:
        //  ۱) updateMany با شرط updatedAt<cutoff: ردیف هست ولی پنجره‌اش تمام →
        //     تمدید (count=1 → views). دو پینگ موازی: اولی شرط را می‌خرد و
        //     updatedAt را می‌بلعد، دومی count=0 می‌گیرد → فقط یک شمارش.
        //  ۲) createMany + skipDuplicates: ردیف اصلاً نبود → ساخت یعنی views؛
        //     هست ولی تازه بود → count=0 → دوباره‌شماری نیست.
        const renewed = await tx.dailyVisitPath.updateMany({
          where: { day, sessionKey, path, updatedAt: { lt: new Date(Date.now() - VIEW_WINDOW_MS) } },
          data: { updatedAt: new Date() },
        });
        let newView = renewed.count > 0;
        if (!newView) {
          const createdPath = await tx.dailyVisitPath.createMany({
            data: [{ day, sessionKey, path }],
            skipDuplicates: true,
          });
          newView = createdPath.count > 0;
        }

        if (!newView && !newSession) return; // هیچ شمارنده‌ای عوض نمی‌شود
        changed = true;

        await tx.dailyVisit.upsert({
          where: { day },
          create: { day, views: newView ? 1 : 0, sessions: newSession ? 1 : 0 },
          update: {
            ...(newView ? { views: { increment: 1 } } : {}),
            ...(newSession ? { sessions: { increment: 1 } } : {}),
          },
        });
      });

      // sweep احتمالی و بدون انتظار — جدول پنجره/نشست نباید بی‌مرز رشد کند
      if (Math.random() < PRUNE_CHANCE) {
        void this.pruneOldRows().catch(() => undefined);
      }

      return { counted: changed };
    } catch (e) {
      this.logger.warn(`visit count failed (${path}): ${e instanceof Error ? e.message : String(e)}`);
      return { counted: false, reason: "ERROR" };
    }
  }

  /**
   * پاک‌سازی ردیف‌های کهنهٔ DailyVisitPath/DailyVisitSession (عمومی برای تست).
   * تجمیع DailyVisit دست‌نخورده می‌ماند — نمودار داشبورد به این ردیف‌ها نیازی ندارد.
   */
  async pruneOldRows(): Promise<void> {
    const cutoff = new Date(tehranDayStart().getTime() - PATH_RETENTION_DAYS * DAY_MS);
    await this.prisma.dailyVisitPath.deleteMany({ where: { day: { lt: cutoff } } });
    await this.prisma.dailyVisitSession.deleteMany({ where: { day: { lt: cutoff } } });
  }

  /**
   * خلاصهٔ بازدید برای داشبورد ادمین — بازهٔ from..to (روز تهران، to شامل است).
   * روزهای بی‌ردیف صفرِ واقعی‌اند — همان روز بازدیدی نیامده است.
   */
  async summary(from: string, to: string): Promise<VisitsSummary> {
    const fromKey = /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : dayKey(tehranDayStart());
    const toKey = /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : fromKey;

    const fromDay = parseDayKey(fromKey);
    // سقف ۳۶۶ روز — نمودار بلندتر از این فقط بار سرور است، نه بینش
    const days = Math.min(366, Math.round((parseDayKey(toKey).getTime() - fromDay.getTime()) / DAY_MS) + 1);
    const endExclusive = new Date(fromDay.getTime() + days * DAY_MS);

    const rows = await this.prisma.dailyVisit.findMany({
      where: { day: { gte: fromDay, lt: endExclusive } },
      orderBy: { day: "asc" },
    });
    const byDay = new Map(rows.map((r) => [dayKey(r.day), r]));

    // همهٔ روزهای بازه را می‌سازیم تا نمودار نقطهٔ گم‌شده (روز بدون بازدید) را
    // به‌عنوان صفرِ واقعی نشان دهد، نه اینکه روز را حذف کند.
    const points: VisitPoint[] = [];
    for (let i = 0; i < days; i++) {
      const key = dayKey(new Date(fromDay.getTime() + i * DAY_MS));
      const r = byDay.get(key);
      points.push({ day: key, views: r?.views ?? 0, sessions: r?.sessions ?? 0 });
    }

    const totals = points.reduce(
      (acc, p) => ({ views: acc.views + p.views, sessions: acc.sessions + p.sessions }),
      { views: 0, sessions: 0 },
    );

    // ── تجمیع‌های تقویمی — همه به وقت تهران ─────────────────────────
    const nowShifted = new Date(Date.now() + TEHRAN_OFFSET_MS);
    const todayStart = tehranDayStart();

    // هفته از شنبه — تقویم ایران
    const dow = nowShifted.getUTCDay(); // 0=یکشنبه … 6=شنبه
    const sinceSaturday = (dow + 1) % 7;
    const weekStart = new Date(todayStart.getTime() - sinceSaturday * DAY_MS);

    const monthStart = new Date(
      Date.UTC(nowShifted.getUTCFullYear(), nowShifted.getUTCMonth(), 1) - TEHRAN_OFFSET_MS,
    );
    const yearStart = new Date(Date.UTC(nowShifted.getUTCFullYear(), 0, 1) - TEHRAN_OFFSET_MS);

    const sumFrom = async (start: Date): Promise<VisitBucket> => {
      const agg = await this.prisma.dailyVisit.aggregate({
        where: { day: { gte: start } },
        _sum: { views: true, sessions: true },
      });
      return { views: agg._sum.views ?? 0, sessions: agg._sum.sessions ?? 0 };
    };
    const [today, week, month, year] = await Promise.all([
      sumFrom(todayStart),
      sumFrom(weekStart),
      sumFrom(monthStart),
      sumFrom(yearStart),
    ]);

    return {
      range: { from: fromKey, to: toKey },
      points,
      totals,
      quick: { today, week, month, year },
    };
  }
}
