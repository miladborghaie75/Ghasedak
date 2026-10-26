/**
 * گام ۲۴ — زیرساخت سهمیهٔ AI و اعتماد شبکه روی DB واقعی.
 *
 * چرا DB-محور: کل نقطهٔ این گام «ذخیره‌ساز مشترک» است — سقف روزانه و پنجرهٔ
 * rate-limit باید بین چند نمونهٔ API و پس از restart برقرار بماند؛ این را فقط
 * با دو کلاینت مستقل روی همان DB می‌شود سنجید. Mock حافظه‌ای دقیقاً چیزی را
 * که باید می‌شمارد، نمی‌شمارد.
 *
 * پوشش:
 *  - جمع هزینهٔ دو قابلیت روی یک سقف مشترک (customer_chat + admin_assistant)
 *  - هم‌زمانی: رزرو اتمیک — مجموعِ رزروها در هیچ تداخلی از سقف نمی‌گذرد
 *  - چند instance و restart: نمونهٔ تازهٔ سرویس، مصرفِ قبلی را می‌بیند
 *  - header جعلی x-forwarded-for: بدون اعتمادِ پراکسی نادیده گرفته می‌شود؛
 *    با TRUST_PROXY_HOPS مقدارِ نزدیک‌ترین پراکسی معتبر خوانده می‌شود
 *  - fail-closed: خطای DB یعنی 503، نه عبور
 *  - سقف روزانهٔ کاربر/نشست در ذخیرهٔ مشترک، بدون ذخیرهٔ کلید خام
 */
import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import type { Request } from "express";
import { AiBudgetService, estimateCostToman, hashUserKey } from "../src/common/ai-budget.service";
import { RateLimitMiddleware, clientKeyOf } from "../src/common/rate-limit.middleware";
import { PrismaService } from "../src/prisma/prisma.service";

jest.setTimeout(120_000);

const ENV_KEYS = [
  "AI_DAILY_CAP_TOMANS",
  "AI_REQUEST_TOMAN",
  "AI_DAILY_USER_REQUESTS",
  "AI_INPUT_TOMAN_PER_MTOK",
  "AI_OUTPUT_TOMAN_PER_MTOK",
  "TRUST_PROXY",
  "TRUST_PROXY_HOPS",
];

function fakeReq(overrides: { ip?: string; url?: string; headers?: Record<string, string> } = {}): Request {
  return {
    ip: overrides.ip,
    url: overrides.url ?? "/customer-chat",
    originalUrl: overrides.url ?? "/customer-chat",
    headers: overrides.headers ?? {},
  } as unknown as Request;
}

function statusFor(error: unknown): { status: number; code: string } {
  expect(error).toBeInstanceOf(HttpException);
  const e = error as HttpException;
  const body = e.getResponse() as { code?: string };
  return { status: e.getStatus(), code: body.code ?? "" };
}

function fakeRes() {
  const res: { statusCode: number; body?: unknown; status: (n: number) => typeof res; json: (b: unknown) => typeof res } = {
    statusCode: 200,
    status(n: number) {
      res.statusCode = n;
      return res;
    },
    json(b: unknown) {
      res.body = b;
      return res;
    },
  };
  return res;
}

describe("گام ۲۴ — واحد: کلید، هش و برآورد", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterAll(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it("هش کلید کاربر پایدار است و کلید خام در هش لو نمی‌رود", () => {
    const h1 = hashUserKey("10.0.0.1|sess-abc");
    expect(h1).toBe(hashUserKey("10.0.0.1|sess-abc"));
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).not.toMatch(/10\.0\.0\.1|sess-abc/);
    expect(hashUserKey("10.0.0.1|sess-abd")).not.toBe(h1);
  });

  it("برآورد هزینه: درخواست + توکن‌ها با نرخ‌های داده‌شده جمع می‌شوند", () => {
    const rates = { requestToman: 250, inputPerMtok: 1_500_000, outputPerMtok: 6_000_000 };
    expect(
      estimateCostToman({ requests: 2, inputTokens: 1_000_000, outputTokens: 500_000 }, rates),
    ).toBe(2 * 250 + 1_500_000 + 3_000_000);
    expect(estimateCostToman({ requests: 0, inputTokens: 0, outputTokens: 0 }, rates)).toBe(0);
  });

  it("header جعلی x-forwarded-for بدون اعلامِ پراکسی نادیده گرفته می‌شود (req.ip ملاک است)", () => {
    const spoofed = fakeReq({ ip: "203.0.113.7", headers: { "x-forwarded-for": "1.2.3.4" } });
    expect(clientKeyOf(spoofed)).toBe("203.0.113.7");
  });

  it("با TRUST_PROXY_HOPS=1 مقدارِ نزدیک‌ترین پراکسیِ قابل‌اعتماد (راستِ فهرست) خوانده می‌شود", () => {
    process.env.TRUST_PROXY_HOPS = "1";
    try {
      const twoHops = fakeReq({ ip: "203.0.113.7", headers: { "x-forwarded-for": "198.51.100.9, 203.0.113.7" } });
      expect(clientKeyOf(twoHops)).toBe("203.0.113.7");
      // کلاینت نمی‌تواند با گذاشتن مقدار در ابتدای XFF خودش را جعل کند؛ مقدار معتبر از راست
      const spoofAttempt = fakeReq({ ip: undefined, headers: { "x-forwarded-for": "6.6.6.6, 10.0.0.2" } });
      expect(clientKeyOf(spoofAttempt)).toBe("10.0.0.2");
    } finally {
      delete process.env.TRUST_PROXY_HOPS;
    }
  });
});

describe("گام ۲۴ — ذخیره‌ساز مشترک روی DB واقعی", () => {
  let prismaA: PrismaService;
  let prismaB: PrismaService;
  let budgetA: AiBudgetService;
  let budgetB: AiBudgetService;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    // دو «instance» مستقل: دو کلاینت Prisma جدا روی همان DB
    prismaA = new PrismaService();
    prismaB = new PrismaService();
    await prismaA.$connect();
    await prismaB.$connect();
    budgetA = new AiBudgetService(prismaA);
    budgetB = new AiBudgetService(prismaB);
    await prismaA.aiUsageDay.deleteMany({});
    await prismaA.aiUserDay.deleteMany({});
    await prismaA.rateLimitWindow.deleteMany({});
  });

  afterAll(async () => {
    await prismaA.aiUsageDay.deleteMany({}).catch(() => undefined);
    await prismaA.aiUserDay.deleteMany({}).catch(() => undefined);
    await prismaA.rateLimitWindow.deleteMany({}).catch(() => undefined);
    await prismaA.$disconnect().catch(() => undefined);
    await prismaB.$disconnect().catch(() => undefined);
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it("سقف هزینه میان دو قابلیت مشترک است — جمع هر دو با یک سقف می‌سنجد", async () => {
    process.env.AI_DAILY_CAP_TOMANS = "1000";
    process.env.AI_REQUEST_TOMAN = "200";
    process.env.AI_OUTPUT_TOMAN_PER_MTOK = "1000";
    // ۲ درخواست customer_chat از instance A + ۲ درخواست admin_assistant از instance B — جمع ۴×۲۰۰=۸۰۰
    for (let i = 0; i < 2; i += 1) {
      await budgetA.reserveRequest("customer_chat");
      await budgetA.recordUsage("customer_chat");
    }
    for (let i = 0; i < 2; i += 1) {
      await budgetB.reserveRequest("admin_assistant");
      await budgetB.recordUsage("admin_assistant");
    }
    // رزرو بعدیِ هر قابلیت: ۸۰۰ + ۲۰۰ = ۱۰۰۰ ≥ سقف → 429 — سقف یکی است، نه جدا برای هر کدام
    await expect(budgetA.reserveRequest("customer_chat")).rejects.toMatchObject({
      status: 429,
      response: { code: "AI_DAILY_CAP_REACHED" },
    });
    await expect(budgetB.reserveRequest("admin_assistant")).rejects.toMatchObject({
      status: 429,
      response: { code: "AI_DAILY_CAP_REACHED" },
    });
    // مصرف توکنیِ همان قابلیت، هزینه را بالای سقف می‌برد → هر دو قابلیت بسته می‌شوند
    await budgetA.recordUsage("customer_chat", { outputTokens: 1_000_000 }); // +۱۰۰۰ تومان با نرخ تست
    await expect(budgetA.assertWithinDailyCap("customer_chat")).rejects.toMatchObject({
      status: 429,
      response: { code: "AI_DAILY_CAP_REACHED" },
    });
    await expect(budgetB.assertWithinDailyCap("admin_assistant")).rejects.toMatchObject({
      status: 429,
      response: { code: "AI_DAILY_CAP_REACHED" },
    });
    const snapA = await budgetA.todaySnapshot();
    const snapB = await budgetB.todaySnapshot();
    expect(snapA.rows.map((r) => r.capability).sort()).toEqual(["admin_assistant", "customer_chat"]);
    expect(snapA.spentToman).toBe(5 * 200 + 1_000); // ۵ درخواستِ ثبت‌شده + توکن خروجی
    // snapshotِ نمونهٔ B همان حقیقت مشترک را می‌بیند
    expect(snapB.spentToman).toBe(snapA.spentToman);
  });

  it("هم‌زمانی: ۲۵ رزرو موازی روی سقف ۱۰ هرگز از سقف عبور نمی‌کند", async () => {
    await prismaA.aiUsageDay.deleteMany({});
    process.env.AI_DAILY_CAP_TOMANS = "10";
    process.env.AI_REQUEST_TOMAN = "1";
    const N = 25;
    const results = await Promise.allSettled(
      Array.from({ length: N }, () => budgetA.reserveRequest("customer_chat")),
    );
    const fulfilled = results.filter((r) => r.status === "fulfilled").length;
    const rejected = results.filter((r) => r.status === "rejected").length;
    expect(fulfilled + rejected).toBe(N);
    expect(rejected).toBeGreaterThan(0);
    // همهٔ ردشده‌ها باید همان 429 سقف باشند، نه خطای دیگر
    for (const r of results) {
      if (r.status === "rejected") {
        expect(statusFor(r.reason)).toMatchObject({ status: 429, code: "AI_DAILY_CAP_REACHED" });
      }
    }
    // ناوردایی: مصروف (صفر) + رزروهای در جریان از سقف نمی‌گذرد
    const row = await prismaA.aiUsageDay.findFirst({ where: { capability: "customer_chat" } });
    expect(row).not.toBeNull();
    const spent = estimateCostToman(row!, { requestToman: 1, inputPerMtok: 1, outputPerMtok: 1 });
    expect(spent + row!.reservedRequests).toBeLessThanOrEqual(10);
    // ظرفیت سقف ۱۰ با نرخ ۱ تومان: دهمین رزرو رد می‌شود (در جریان + مصروف < سقف)
    expect(fulfilled).toBe(9);
    expect(row!.reservedRequests).toBe(9);
  });

  it("چند instance و restart: نمونهٔ تازه، مصرف و رزروِ باقی‌مانده را می‌بیند", async () => {
    await prismaA.aiUsageDay.deleteMany({});
    process.env.AI_DAILY_CAP_TOMANS = "100";
    process.env.AI_REQUEST_TOMAN = "50";
    process.env.AI_INPUT_TOMAN_PER_MTOK = "1000";
    process.env.AI_OUTPUT_TOMAN_PER_MTOK = "1000";
    await budgetA.reserveRequest("customer_chat"); // رزروِ در جریان (آزادنشده)
    await budgetA.recordUsage("customer_chat", { inputTokens: 1000, outputTokens: 2000 });
    // «restart»: سرویس کاملاً تازه روی کلاینت دیگر (حافظهٔ هیچ‌کدام مشترک نیست)
    const freshPrisma = new PrismaService();
    await freshPrisma.$connect();
    try {
      const fresh = new AiBudgetService(freshPrisma);
      const snap = await fresh.todaySnapshot();
      // مصرف ۱ (درخواست) و توکن‌ها با نرخ پیش‌فرض تومان، و رزرو آزادشده توسط recordUsage
      expect(snap.rows.find((r) => r.capability === "customer_chat")?.requests).toBe(1);
      expect(snap.reservedRequests).toBe(0); // تسویهٔ مصرف، رزروی را که reserve کرده بود آزاد کرده
      // سقف باز هم بسته است: ۵۰ + توکن‌ها با نرخ پیش‌فرض (AI_REQUEST_TOMAN=50 ست شده) …
      // مصروفِ ثبت‌شده ≥ سقف نیست → سقف باز است
      await expect(fresh.assertWithinDailyCap("customer_chat")).resolves.toBeUndefined();
    } finally {
      await freshPrisma.$disconnect().catch(() => undefined);
    }
  });

  it("سقف روزانهٔ کاربر/نشست بین instance ها مشترک است و کلید خام در DB نمی‌رود", async () => {
    await prismaA.aiUserDay.deleteMany({});
    process.env.AI_DAILY_USER_REQUESTS = "3";
    const userKey = "203.0.113.9|sess-test";
    // سه فراخوانی موفق، بین دو نمونهٔ مستقل جابه‌جا — شمارنده یکی است
    for (let i = 0; i < 3; i += 1) {
      await (i % 2 === 0 ? budgetA : budgetB).assertWithinUserCap(userKey);
    }
    // نفر چهارم از هر instance: 429
    const over4 = await budgetB.assertWithinUserCap(userKey).then(() => null, (e: unknown) => statusFor(e));
    expect(over4).toMatchObject({ status: 429, code: "AI_USER_CAP_REACHED" });
    // درخواستِ ردشده سهمی نمی‌سوزاند: همچنان ۳ است
    const row = await prismaA.aiUserDay.findFirst();
    expect(row?.requests).toBe(3);
    // ledger فقط هش دارد؛ کلید خامِ کاربر هرگز در ردیف نیست
    expect(JSON.stringify(row)).not.toContain("203.0.113.9");
    expect(JSON.stringify(row)).not.toContain("sess-test");
    // کاربرِ دیگر سهمیهٔ جدا دارد
    await expect(budgetA.assertWithinUserCap("203.0.113.10|sess-other")).resolves.toBeUndefined();
  });

  it("fail-closed: خطای DB در گیتِ سقف یعنی 503، نه عبور", async () => {
    const broken = new AiBudgetService({
      aiUsageDay: {
        findMany: () => Promise.reject(new Error("db down")),
      },
    } as unknown as PrismaService);
    const result = await broken.assertWithinDailyCap("customer_chat").then(() => null, (e: unknown) => statusFor(e));
    expect(result).toMatchObject({ status: 503, code: "AI_BUDGET_UNAVAILABLE" });
    // رزرو هم fail-closed است
    const brokenTx = new AiBudgetService({
      $transaction: () => Promise.reject(new Error("db down")),
    } as unknown as PrismaService);
    const reserveResult = await brokenTx.reserveRequest("customer_chat").then(() => null, (e: unknown) => statusFor(e));
    expect(reserveResult).toMatchObject({ status: 503, code: "AI_BUDGET_UNAVAILABLE" });
  });

  it("آزادسازی رزروِ ثبت‌نشده خطا نمی‌سازد (P2025 بلعیده می‌شود)", async () => {
    await prismaA.aiUsageDay.deleteMany({});
    await expect(budgetA.releaseReservation("customer_chat")).resolves.toBeUndefined();
  });
});

describe("گام ۲۴ — rate limit مشترک (Middleware روی DB واقعی)", () => {
  let prisma: PrismaService;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    prisma = new PrismaService();
    await prisma.$connect();
    await prisma.rateLimitWindow.deleteMany({});
  });

  afterAll(async () => {
    await prisma.rateLimitWindow.deleteMany({}).catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  async function drive(mw: RateLimitMiddleware, req: Request): Promise<number> {
    const res = fakeRes();
    let called = false;
    await mw.use(req, res as never, () => {
      called = true;
    });
    return called ? 200 : res.statusCode;
  }

  it("شمارنده بین دو middleware مستقل (دو instance) مشترک است", async () => {
    process.env.TRUST_PROXY = "";
    delete process.env.TRUST_PROXY_HOPS;
    const mwA = new RateLimitMiddleware(prisma);
    const mwB = new RateLimitMiddleware(prisma);
    const key = `10.11.12.${Math.floor(Math.random() * 200) + 10}`;
    // قانون /auth/login سخت‌گیرانه است: max=5 در دقیقه — هر بار instance دیگر
    for (let i = 1; i <= 5; i += 1) {
      const status = await drive(i % 2 === 0 ? mwA : mwB, fakeReq({ ip: key, url: "/auth/login" }));
      expect(status).toBe(200);
    }
    // درخواست ششم از هر instance: 429 — اگر شمارنده در حافظه بود، هر instance تا ۵ می‌گذاشت
    const statusA = await drive(mwA, fakeReq({ ip: key, url: "/auth/login" }));
    const statusB = await drive(mwB, fakeReq({ ip: key, url: "/auth/login" }));
    expect(statusA).toBe(429);
    expect(statusB).toBe(429);
  });

  it("header جعلی: بدون TRUST_PROXY کلاینتِ محدودشده با XFF محدودیت را دور نمی‌زند", async () => {
    delete process.env.TRUST_PROXY;
    delete process.env.TRUST_PROXY_HOPS;
    const mw = new RateLimitMiddleware(prisma);
    const key = `10.21.22.${Math.floor(Math.random() * 200) + 10}`;
    // ۵ درخواست موفق login از همین IP
    for (let i = 0; i < 5; i += 1) {
      await drive(mw, fakeReq({ ip: key, url: "/auth/login" }));
    }
    // حالا کلاینتِ محدودشده XFF جعلی می‌گذارد — باید همچنان با همان IP شمرده و 429 شود
    const spoofed = fakeReq({
      ip: key,
      url: "/auth/login",
      headers: { "x-forwarded-for": "99.99.99.99" },
    });
    expect(await drive(mw, spoofed)).toBe(429);
    // IP جعلی‌شده در DB ثبت نشده — فقط هش windowKey هست
    const rows = await prisma.rateLimitWindow.findMany({ select: { windowKey: true } });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.windowKey).toMatch(/^[0-9a-f]{64}$/);
      expect(r.windowKey).not.toContain("99.99.99.99");
    }
  });

  it("پنجرهٔ فروشگاه /customer-chat هم مشترک است (دو instance، یک شمارنده)", async () => {
    const mwA = new RateLimitMiddleware(prisma);
    const mwB = new RateLimitMiddleware(prisma);
    const key = `10.31.32.${Math.floor(Math.random() * 200) + 10}`;
    for (let i = 0; i < 20; i += 1) {
      const status = await drive(i % 2 === 0 ? mwA : mwB, fakeReq({ ip: key, url: "/customer-chat" }));
      expect(status).toBe(200);
    }
    expect(await drive(mwA, fakeReq({ ip: key, url: "/customer-chat" }))).toBe(429);
    expect(await drive(mwB, fakeReq({ ip: key, url: "/customer-chat" }))).toBe(429);
  });

  it("مسیرِ خارج از قانون محدود نمی‌شود", async () => {
    const mw = new RateLimitMiddleware(prisma);
    expect(await drive(mw, fakeReq({ ip: "10.0.0.1", url: "/health" }))).toBe(200);
  });
});
