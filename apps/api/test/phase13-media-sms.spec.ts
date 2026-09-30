/**
 * آزمون امکانات جدید (فاز ۱۳) — روی DB آزمایش اجرا می‌شود:
 *  1) لایهٔ چند-اپراتور پیامک: ۶ اپراتور، بدون کلید → QUEUED صادقانه (بند ۱۱۱)،
 *     انتخاب اپراتور فعال از Setting، ماسک کلید، اپراتور نامعتبر
 *  2) رسانه: ساخت ردیف تستی → detail با usage → رفتار BigInt (sizeBytes عدد) → حذف با unlink
 * همهٔ ردیف‌های تست با نام یکتا ساخته و در پایان حذف می‌شوند — بدون دست‌زدن به دادهٔ واقعی.
 */
import "reflect-metadata";
import { join } from "node:path";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

// MEDIA_DIR باید قبل از import کنترلر تنظیم شود (ثابت ماژول هنگام import خوانده می‌شود)
const mediaDir = mkdtempSync(join(tmpdir(), "ghasedak-media-test-"));
process.env.MEDIA_DIR = mediaDir;

import { PrismaService } from "../src/prisma/prisma.service";
import { SmsProvidersService, SMS_PROVIDERS } from "../src/events/sms-providers.service";
import { CapabilitiesController } from "../src/admin/capabilities.controller";

jest.setTimeout(120_000);

describe("Phase 13 — sms multi-provider layer", () => {
  let prisma: PrismaService;
  let svc: SmsProvidersService;
  const OLD_ENV = process.env;

  beforeAll(async () => {
    process.env = { ...OLD_ENV };
    // بدون هیچ کلید پیامک — رفتار صادقانهٔ بدون-کلید
    for (const p of SMS_PROVIDERS) delete process.env[p.envKey];
    prisma = new PrismaService();
    await prisma.$connect();
    svc = new SmsProvidersService(prisma);
  });

  afterAll(async () => {
    process.env = OLD_ENV;
    await prisma.$disconnect();
  });

  it("همهٔ ۶ اپراتور ثبت شده‌اند و هرکدام envKey مستقل دارند", () => {
    expect(SMS_PROVIDERS).toHaveLength(6);
    const ids = SMS_PROVIDERS.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(["kavenegar", "ghasedaksms", "melipayamak", "mediana", "ippanel", "idehpardaz"]));
    const keys = new Set(SMS_PROVIDERS.map((p) => p.envKey));
    expect(keys.size).toBe(6);
  });

  it("اپراتور فعال پیش‌فرض کاوه‌نگار است (سازگاری با گذشته)", async () => {
    await prisma.setting.upsert({ where: { key: "sms" }, update: { value: {} }, create: { key: "sms", value: {} } });
    expect(await svc.activeProviderId()).toBe("kavenegar");
  });

  it("اپراتور فعال از Setting خوانده می‌شود", async () => {
    await prisma.setting.upsert({ where: { key: "sms" }, update: { value: { provider: "ippanel" } }, create: { key: "sms", value: { provider: "ippanel" } } });
    expect(await svc.activeProviderId()).toBe("ippanel");
    await prisma.setting.upsert({ where: { key: "sms" }, update: { value: { provider: "kavenegar" } }, create: { key: "sms", value: { provider: "kavenegar" } } });
  });

  it("بدون کلید → QUEUED با خطای NOT_CONFIGURED صادقانه (هیچ ارسال جعلی)", async () => {
    const r = await svc.send("09120000000", "پیام آزمایشی", null);
    expect(r.state).toBe("QUEUED");
    expect(r.error).toContain("NOT_CONFIGURED");
  });

  it("providersStatus کلید تنظیم‌نشده را configured:false با ماسک null گزارش می‌کند", () => {
    const st = svc.providersStatus();
    expect(st).toHaveLength(6);
    for (const p of st) {
      expect(p.configured).toBe(false);
      expect(p.masked).toBeNull();
    }
  });

  it("ماسک کلید کوتاه/بلند درست است", () => {
    process.env.IPPANEL_API_KEY = "abc";
    process.env.KAVENEGAR_API_KEY = "1234567890abcdef";
    const st = svc.providersStatus();
    const ip = st.find((p) => p.id === "ippanel")!;
    const kav = st.find((p) => p.id === "kavenegar")!;
    expect(ip.configured).toBe(true);
    expect(ip.masked).toBe("••••");
    expect(kav.masked).toBe("123…cdef");
    delete process.env.IPPANEL_API_KEY;
    delete process.env.KAVENEGAR_API_KEY;
  });

  it("activeProviderId با مقدار نامعتبر به کاوه‌نگار برمی‌گردد", async () => {
    await prisma.setting.upsert({ where: { key: "sms" }, update: { value: { provider: "nashenas" } }, create: { key: "sms", value: { provider: "nashenas" } } });
    expect(await svc.activeProviderId()).toBe("kavenegar");
    await prisma.setting.upsert({ where: { key: "sms" }, update: { value: { provider: "kavenegar" } }, create: { key: "sms", value: { provider: "kavenegar" } } });
  });
});

describe("Phase 13 — media service (CapabilitiesController)", () => {
  let prisma: PrismaService;
  let ctrl: CapabilitiesController;
  let testKey: string;
  let testId: string;
  const OLD_ENV = process.env;

  beforeAll(async () => {
    process.env = { ...OLD_ENV, MEDIA_DIR: mediaDir };
    prisma = new PrismaService();
    await prisma.$connect();
    ctrl = new CapabilitiesController(prisma, {} as never, {} as never);
  });

  afterAll(async () => {
    process.env = OLD_ENV;
    if (testId) await prisma.media.delete({ where: { id: testId } }).catch(() => undefined);
    if (mediaDir && mediaDir.includes("ghasedak-media-test-")) rmSync(mediaDir, { recursive: true, force: true });
    await prisma.$disconnect();
  });

  it("آپلود: ردیف می‌سازد، فایل می‌نویسد، sizeBytes عدد است (رفتار BigInt)", async () => {
    // PNG 1x1 با magic درست
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
    const r = await ctrl.upload({ filename: "t.png", mime: "image/png", dataBase64: png.toString("base64"), alt: "تست آزمون" });
    expect(r.id).toBeTruthy();
    testId = r.id;
    testKey = r.key;
    const row = await prisma.media.findUnique({ where: { id: r.id } });
    expect(row).toBeTruthy();
    expect(Number(row!.sizeBytes)).toBe(png.length);
    expect(existsSync(join(mediaDir, r.key))).toBe(true);
  });

  it("جزئیات: usage صفر و sizeBytes عددی برمی‌گرداند", async () => {
    const d = await ctrl.mediaDetail(testId);
    expect(d.usage).toEqual({ products: 0, brands: 0, categories: 0, total: 0 });
    expect(typeof d.sizeBytes).toBe("number");
    expect(d.alt).toBe("تست آزمون");
  });

  it("ویرایش متادیتا: title/caption ذخیره می‌شود", async () => {
    const u = await ctrl.mediaUpdate(testId, { title: "عنوان آزمون", caption: undefined });
    expect(u.ok).toBe(true);
    expect(u.title).toBe("عنوان آزمون");
  });

  it("جایگزینی: key جدید، فایل قدیمی حذف، فایل جدید موجود", async () => {
    const png2 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    const oldKey = testKey;
    const r = await ctrl.mediaReplace(testId, { filename: "t2.png", mime: "image/png", dataBase64: png2.toString("base64") });
    expect(r.key).not.toBe(oldKey);
    expect(existsSync(join(mediaDir, oldKey))).toBe(false);
    expect(existsSync(join(mediaDir, r.key))).toBe(true);
    testKey = r.key;
  });

  it("آپلود با magic جعلی رد می‌شود (بند ۱۱۰)", async () => {
    const fake = Buffer.from("این یک فایل متنی است ولی جعلی jpg خورده");
    await expect(
      ctrl.upload({ filename: "f.jpg", mime: "image/jpeg", dataBase64: fake.toString("base64") }),
    ).rejects.toThrow();
  });

  it("حذف: فایل و ردیف هر دو پاک می‌شوند", async () => {
    const keyBefore = testKey;
    const r = await ctrl.deleteMedia(testId);
    expect(r).toEqual({ ok: true });
    expect(existsSync(join(mediaDir, keyBefore))).toBe(false);
    testId = "";
  });
});
