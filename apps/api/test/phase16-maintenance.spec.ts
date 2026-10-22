/**
 * گام ۱۰ — endpoint عمومی وضعیت تعمیر (storefront همین مسیر را می‌خواند).
 * رفتار واقعی روی DB: پیش‌فرض خاموش، فقط enabled===true فعال، پیام/مهلت فقط
 * رشتهٔ غیرخالی برمی‌گردند. ردیف خودش را پاک می‌کند (الگوی rehearsal).
 */
import "reflect-metadata";
import { PrismaService } from "../src/prisma/prisma.service";
import { PublicThemeController } from "../src/admin/public-theme.controller";

jest.setTimeout(120_000);

describe("Phase 16 — public maintenance endpoint", () => {
  let prisma: PrismaService;
  let controller: PublicThemeController;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    controller = new PublicThemeController(prisma);
  });

  afterAll(async () => {
    await prisma.setting.deleteMany({ where: { key: "maintenance" } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("بدون ردیف → خاموش و بدون پیام (fail-safe: پیش‌فرض باز)", async () => {
    await prisma.setting.deleteMany({ where: { key: "maintenance" } }).catch(() => undefined);
    const r = (await controller.maintenance()) as { enabled: boolean; message?: string };
    expect(r.enabled).toBe(false);
    expect(r.message).toBeUndefined();
  });

  it("enabled=true → فعال؛ پیام خالی پاسخ نمی‌آید", async () => {
    await prisma.setting.upsert({
      where: { key: "maintenance" },
      update: { value: { enabled: true, message: "" } },
      create: { key: "maintenance", value: { enabled: true, message: "" } },
    });
    const r = (await controller.maintenance()) as { enabled: boolean; message?: string };
    expect(r.enabled).toBe(true);
    expect(r.message).toBeUndefined();
  });

  it("پیام و مهلت معتبر برمی‌گردند", async () => {
    await prisma.setting.upsert({
      where: { key: "maintenance" },
      update: { value: { enabled: true, message: "تا امشب باز می‌شویم.", until: "امشب" } },
      create: { key: "maintenance", value: { enabled: true, message: "تا امشب باز می‌شویم.", until: "امشب" } },
    });
    const r = (await controller.maintenance()) as { enabled: boolean; message?: string; until?: string };
    expect(r.enabled).toBe(true);
    expect(r.message).toBe("تا امشب باز می‌شویم.");
    expect(r.until).toBe("امشب");
  });

  it("enabled=false (به‌هر شکل دیگر) → فروشگاه باز", async () => {
    await prisma.setting.upsert({
      where: { key: "maintenance" },
      update: { value: { enabled: false, message: "متن بی‌اثر" } },
      create: { key: "maintenance", value: { enabled: false, message: "متن بی‌اثر" } },
    });
    const r = (await controller.maintenance()) as { enabled: boolean };
    expect(r.enabled).toBe(false);
  });
});
