/**
 * گام ۱۵-۶ — شمارش بازدید روزانهٔ first-party روی rehearsal DB:
 *  ۱) شمارش همیشه‌روشن است: بدون رضایت ANALYTICS هم شمرده می‌شود (تصمیم D-5)؛
 *  ۲) هر ناوبری یک views؛ هر نشست روزی یک sessions (idempotent)؛
 *  ۳) summary: نقاط روزانه + تجمیع‌های تقویمی، روز بدون بازدید = صفرِ واقعی؛
 *  ۴) بازهٔ چندروزه: روزهای خالی صفرِ واقعی؛
 *  ۵) dedupe (D-6): همان مسیر در پنجرهٔ ۳۰ دقیقه یک‌بار؛ پنجرهٔ تمام‌شده دوباره می‌شمارد؛
 *  ۶) بات (D-6): UA خزنده حتی نشست هم نمی‌سازد؛ UA غایب/مرورگر واقعی می‌شمارد؛
 *  ۷) پاک‌سازی (D-6): ردیف‌های کهنهٔ پنجره/نشست حذف، تجمیع DailyVisit می‌ماند.
 *
 * عددها به‌صورت «دلتا» سنجه می‌شوند چون جدول DailyVisitِ امروزِ مشترک
 * است و تست‌های موازی/ترافیک واقعی هم در همان روز می‌نویسند.
 */
import "reflect-metadata";
import { PrismaService } from "../src/prisma/prisma.service";
import { VisitsService } from "../src/analytics/visits.service";

jest.setTimeout(60_000);

const MARK = Date.now().toString(36);
const DAY_MS = 24 * 60 * 60 * 1000;

describe("Phase 15 — daily visits (first-party, always-on)", () => {
  let prisma: PrismaService;
  let svc: VisitsService;
  const sessionA = `test-visits-a-${MARK}-${"x".repeat(8)}`; // uuid-مانند
  const sessionB = `test-visits-b-${MARK}-${"y".repeat(8)}`;
  const sessionNo = `test-visits-no-${MARK}-${"z".repeat(8)}`;
  const sessionDd = `test-visits-dd-${MARK}-${"d".repeat(8)}`;
  const sessionBot = `test-visits-bot-${MARK}-${"b".repeat(8)}`;
  const ALL_SESSIONS = [sessionA, sessionB, sessionNo, sessionDd, sessionBot];
  let oldDay: Date | null = null; // روز ساختگیِ تست ۷ — برای پاک‌سازی afterAll
  let oldDayAggregateCreated = false;

  /** سطر امروز (قبل/بعد) برای سنجهٔ دلتا */
  const todayRow = async () => {
    const shifted = new Date(Date.now() + 3.5 * 60 * 60 * 1000);
    const day = new Date(
      Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - 3.5 * 60 * 60 * 1000,
    );
    return (
      (await prisma.dailyVisit.findUnique({ where: { day } })) ?? { day, views: 0, sessions: 0 }
    );
  };

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    svc = new VisitsService(prisma);

    // A و B رضایت دارند؛ C عمداً بدون رضایت می‌ماند تا بی‌اثریِ رضایت روی شمارش اثبات شود
    for (const key of [sessionA, sessionB]) {
      await prisma.consentRecord.upsert({
        where: { ownerKey_kind: { ownerKey: key, kind: "ANALYTICS" } },
        create: { ownerType: "guest_session", ownerKey: key, kind: "ANALYTICS", granted: true, source: "test" },
        update: { granted: true },
      });
    }
  });

  afterAll(async () => {
    // پاک‌سازی فقط ردیف‌های همین تست — هرگز کل جدول را
    await prisma.dailyVisitPath.deleteMany({ where: { sessionKey: { in: ALL_SESSIONS } } });
    await prisma.dailyVisitSession.deleteMany({ where: { sessionKey: { in: ALL_SESSIONS } } });
    await prisma.consentRecord.deleteMany({
      where: { ownerKey: { in: ALL_SESSIONS } },
    });
    if (oldDay && oldDayAggregateCreated) {
      await prisma.dailyVisit.delete({ where: { day: oldDay } }); // سطر ساختگیِ تست ۷
    }
    await prisma.$disconnect();
  });

  it("۱) بدون رضایت ANALYTICS هم شمرده می‌شود (شمارش همیشه‌روشن — D-5)", async () => {
    const before = await todayRow();
    const res = await svc.recordVisit(sessionNo, "/p/test");
    expect(res.counted).toBe(true);
    const after = await todayRow();
    // ترافیک واقعی ممکن است همین لحظه بنویسد؛ شرط «حداقل یکی» برای امنیت race
    expect(after.views - before.views).toBeGreaterThanOrEqual(1);
    // نشست هم ساخته می‌شود — وضعیت ConsentRecord به شمارش ربطی ندارد
    const sess = await prisma.dailyVisitSession.findUnique({
      where: { day_sessionKey: { day: after.day, sessionKey: sessionNo } },
    });
    expect(sess).not.toBeNull();
  });

  it("۲) با رضایت: هر ناوبری یک views، هر نشست روزی فقط یک sessions", async () => {
    const before = await todayRow();

    const r1 = await svc.recordVisit(sessionA, "/p/shoe-1");
    const r2 = await svc.recordVisit(sessionA, "/p/shoe-2"); // ناوبری دومِ همان نشست
    const r3 = await svc.recordVisit(sessionB, "/"); // نشست دیگر

    expect(r1.counted).toBe(true);
    expect(r2.counted).toBe(true);
    expect(r3.counted).toBe(true);

    const after = await todayRow();
    expect(after.views - before.views).toBe(3); // سه ناوبری
    expect(after.sessions - before.sessions).toBe(2); // دو نشست یکتا

    // idempotent بودن session — رکورد تکراری sessions را بالا نمی‌برد
    const r4 = await svc.recordVisit(sessionA, "/cart");
    expect(r4.counted).toBe(true);
    const after2 = await todayRow();
    expect(after2.views - after.views).toBe(1);
    expect(after2.sessions - after.sessions).toBe(0); // همان نشست، روز همان روز
  });

  it("۳) summary: نقاط روزانه کامل + تجمیع‌های تقویمیِ همسو با شمارش", async () => {
    const todayKey = new Date(Date.now() + 3.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const s = await svc.summary(todayKey, todayKey);

    expect(s.range).toEqual({ from: todayKey, to: todayKey });
    expect(s.points).toHaveLength(1); // بازهٔ تک‌روز = یک نقطه، صفرِ واقعی هم حذف نمی‌شود
    expect(s.points[0].day).toBe(todayKey);

    // مجموع بازه با مجموع نقاط می‌خواند
    expect(s.totals.views).toBe(s.points.reduce((n, p) => n + p.views, 0));
    expect(s.totals.sessions).toBe(s.points.reduce((n, p) => n + p.sessions, 0));

    // تجمیع‌ها مونوتون‌اند: سال ≥ ماه ≥ هفته ≥ امروز (هرکدام زیرمجموعهٔ قبلی است)
    expect(s.quick.year.views).toBeGreaterThanOrEqual(s.quick.month.views);
    expect(s.quick.month.views).toBeGreaterThanOrEqual(s.quick.week.views);
    expect(s.quick.week.views).toBeGreaterThanOrEqual(s.quick.today.views);

    // و بازیدِ امروز واقعاً در همهٔ سطل‌ها هست (تست ۲ همین امروز نوشت)
    expect(s.quick.today.views).toBeGreaterThan(0);
    expect(s.quick.today.sessions).toBeGreaterThan(0);
  });

  it("۴) بازهٔ چندروزه: روزهای خالی صفرِ واقعی می‌مانند و مرتب‌اند", async () => {
    const s = await svc.summary("2026-01-01", "2026-01-05");
    expect(s.points).toHaveLength(5);
    expect(s.points.map((p) => p.day)).toEqual([
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
      "2026-01-04",
      "2026-01-05",
    ]);
    // روزهایی که هنوز چنین شمارشی وجود نداشت — همه صفرِ واقعی
    for (const p of s.points) {
      expect(p.views).toBe(0);
      expect(p.sessions).toBe(0);
    }
  });

  // ——— تصمیم D-6 (۲۰۲۶-۱۰-۱۸): مقاوم‌سازی در برابر refresh تکراری و بات ———

  it("۵) dedupe: همان مسیر در پنجرهٔ ۳۰ دقیقه فقط یک‌بار؛ پنجرهٔ تمام‌شده دوباره می‌شمارد", async () => {
    const before = await todayRow();

    const r1 = await svc.recordVisit(sessionDd, "/p/dedupe");
    const r2 = await svc.recordVisit(sessionDd, "/p/dedupe"); // F5 همان مسیر
    const r3 = await svc.recordVisit(sessionDd, "/p/other"); // ناوبری به مسیر دیگر

    expect(r1.counted).toBe(true); // اولین پینگ: views + sessions
    expect(r2.counted).toBe(false); // تکرار در پنجره — هیچ شمارنده‌ای تکان نخورد
    expect(r3.counted).toBe(true); // مسیر تازه — views جدید

    const after = await todayRow();
    expect(after.views - before.views).toBe(2); // دو مسیر یکتا، نه سه پینگ
    expect(after.sessions - before.sessions).toBe(1); // یک نشست یکتا

    // پنجره را دستی به‌عقب می‌بریم (۳۱ دقیقه) — برگشت بعد از وقفه باید شمرده شود
    const pathRow = await prisma.dailyVisitPath.findUnique({
      where: { day_sessionKey_path: { day: after.day, sessionKey: sessionDd, path: "/p/dedupe" } },
    });
    expect(pathRow).not.toBeNull();
    await prisma.dailyVisitPath.update({
      where: { day_sessionKey_path: { day: after.day, sessionKey: sessionDd, path: "/p/dedupe" } },
      data: { updatedAt: new Date(Date.now() - 31 * 60 * 1000) },
    });
    const r4 = await svc.recordVisit(sessionDd, "/p/dedupe");
    expect(r4.counted).toBe(true); // پنجرهٔ تازه
    const after2 = await todayRow();
    expect(after2.views - after.views).toBe(1);
    expect(after2.sessions - after.sessions).toBe(0); // نشستِ همان روز تکرار نمی‌شود
  });

  it("۶) بات: UA خزنده شمرده نمی‌شود و حتی نشست هم نمی‌سازد؛ UA غایب می‌شمارد", async () => {
    // خزنده‌های معروف — هر دو سمت (پراکسی فروشگاه و API) همین فهرست contracts را دارند
    const bots = [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "curl/8.5.0",
      "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
      "python-requests/2.31.0",
    ];
    for (const ua of bots) {
      const r = await svc.recordVisit(sessionBot, "/", ua);
      expect(r).toEqual({ counted: false, reason: "BOT" });
    }
    // بات حتی ردیف نشست/مسیر نمی‌سازد — views و sessions دست‌نخورده
    const t = await todayRow();
    expect(
      await prisma.dailyVisitSession.findUnique({
        where: { day_sessionKey: { day: t.day, sessionKey: sessionBot } },
      }),
    ).toBeNull();
    expect(
      await prisma.dailyVisitPath.findUnique({
        where: { day_sessionKey_path: { day: t.day, sessionKey: sessionBot, path: "/" } },
      }),
    ).toBeNull();

    // مرورگر واقعی می‌شمارد — فهرست بات نباید انسان‌ها را ببلعد
    const human = await svc.recordVisit(
      sessionBot,
      "/p/shoe-1",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    );
    expect(human.counted).toBe(true);

    // UA غایب = فراخوانی داخلی/تست — بات فرض نمی‌شود (تست‌های ۱و۲ همین را می‌سنجند)
    const noUa = await svc.recordVisit(sessionBot, "/p/shoe-2");
    expect(noUa.counted).toBe(true);
  });

  it("۷) پاک‌سازی: ردیف‌های کهنهٔ پنجره/نشست حذف می‌شوند، تجمیع DailyVisit می‌ماند", async () => {
    const t = await todayRow();
    oldDay = new Date(t.day.getTime() - 5 * DAY_MS); // ۵ روز پیش — فراتر از نگهداشت ۲ روزه

    await prisma.dailyVisitPath.createMany({
      data: [
        { day: oldDay, sessionKey: sessionBot, path: "/old-a" },
        { day: oldDay, sessionKey: sessionBot, path: "/old-b" },
      ],
      skipDuplicates: true,
    });
    await prisma.dailyVisitSession.createMany({
      data: [{ day: oldDay, sessionKey: sessionBot }],
      skipDuplicates: true,
    });
    // اگر تجمیع آن روز از قبل هست، دست نمی‌زنیم؛ اگر نیست می‌سازیم تا «ماندنش» را بسنجیم
    const existed = await prisma.dailyVisit.findUnique({ where: { day: oldDay } });
    if (!existed) {
      await prisma.dailyVisit.create({ data: { day: oldDay, views: 7, sessions: 3 } });
      oldDayAggregateCreated = true;
    }

    await svc.pruneOldRows();

    expect(
      await prisma.dailyVisitPath.count({ where: { day: oldDay, sessionKey: sessionBot } }),
    ).toBe(0);
    expect(
      await prisma.dailyVisitSession.count({ where: { day: oldDay, sessionKey: sessionBot } }),
    ).toBe(0);
    const kept = await prisma.dailyVisit.findUnique({ where: { day: oldDay } });
    expect(kept).not.toBeNull(); // نمودار داشبورد به ردیف‌های حذف‌شده وابسته نیست
    if (oldDayAggregateCreated) {
      expect(kept?.views).toBe(7);
      expect(kept?.sessions).toBe(3);
    }
  });
});
