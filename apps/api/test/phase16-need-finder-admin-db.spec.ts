/**
 * گام ۱۶ — API ادمین ویزارد روی DB واقعی (بند ۹+۲۰).
 *
 * چرا DB-محور: `assertRuleMatchesCatalog` دروازهٔ «گزینهٔ مرده» است — اگر دسته یا
 * جنسی که در کاتالوگ نیست رد نشود، گزینه‌ای ساخته می‌شود که هیچ‌وقت محصولی
 * نشان نمی‌دهد و هیچ‌کس هم نمی‌فهمد چرا. این را فقط با دادهٔ واقعی می‌شود سنجید.
 *
 * همچنین: واژگان (فهرست دسته/ترم) باید همان چیزی باشد که قاعده با آن سنجیده می‌شود.
 */
import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import { PrismaService } from "../src/prisma/prisma.service";
import { AdminNeedFinderController } from "../src/catalog/admin-need-finder.controller";

jest.setTimeout(120_000);

describe("Phase 16 — admin need-finder (DB)", () => {
  let prisma: PrismaService;
  let ctl: AdminNeedFinderController;
  const stepId = "nfs-t-admin-db";
  const createdOptionIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    ctl = new AdminNeedFinderController(prisma);
    await prisma.needFinderStep.deleteMany({ where: { id: stepId } });
    await prisma.needFinderStep.create({
      data: { id: stepId, question: "گام تست ادمین", sortOrder: 900, active: true },
    });
  });

  afterAll(async () => {
    await prisma.needFinderStep.deleteMany({ where: { id: stepId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("واژگان: دسته‌ها و ترم‌های واقعی کاتالوگ را می‌دهد", async () => {
    const v = await ctl.vocabulary();
    expect(v.categories.length).toBeGreaterThan(0);
    expect(v.attributes.length).toBeGreaterThan(0);
    // هر slug دسته باید در خود DB هم وجود داشته باشد (واژگان = همان حقیقت)
    const cats = await prisma.category.findMany({
      where: { slug: { in: v.categories.map((c) => c.slug) } },
      select: { slug: true },
    });
    expect(cats.length).toBe(v.categories.length);
    // ترم‌های جنس (material) همان‌هایی هستند که قاعدهٔ ویزارد به آن‌ها اشاره می‌کند
    const material = v.attributes.find((a) => a.slug === "material");
    expect(material?.terms.length).toBeGreaterThan(0);
  });

  it("قاعدهٔ ناشناخته رد می‌شود: دستهٔ جعلی و جنسِ جعلی", async () => {
    await expect(
      ctl.createOption(stepId, { label: "گزینهٔ بد", rule: { categories: ["no-such-category"] } }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      ctl.createOption(stepId, { label: "گزینهٔ بد", rule: { attributeTerms: ["جنسِ جعلی"] } }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("گزینهٔ معتبر ساخته و بعد حذف می‌شود — قاعده به کاتالوگ می‌خورد", async () => {
    const v = await ctl.vocabulary();
    const cat = v.categories[0].slug;
    const created = await ctl.createOption(stepId, {
      label: "گزینهٔ معتبر",
      rule: { categories: [cat], why: "دلیل تست" },
    });
    createdOptionIds.push(created.id);
    expect(created.id).toBeTruthy();
    const row = await prisma.needFinderOption.findUnique({ where: { id: created.id } });
    expect(row?.rule).toMatchObject({ categories: [cat], why: "دلیل تست" });

    await ctl.deleteOption(created.id);
    createdOptionIds.pop();
    expect(await prisma.needFinderOption.findUnique({ where: { id: created.id } })).toBeNull();
  });

  it("شناسهٔ ناپایدار رد می‌شود (فقط حروف کوچک/عدد/خط تیره)", async () => {
    await expect(ctl.createOption(stepId, { id: "گزینه فارسی", label: "بد" })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(ctl.createOption(stepId, { id: "has space", label: "بد" })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("ترتیب‌دهی: فهرست ناقص گام‌ها رد می‌شود (همان‌طور که پنل ادمین می‌فرستد)", async () => {
    await expect(ctl.reorder({ kind: "step", ids: [stepId] })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(ctl.reorder({ kind: "bogus", ids: [stepId] })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("پیش‌فرض‌ها برمی‌گردند: restore-defaults گام‌های قراردادی را در DB می‌نویسد", async () => {
    const res = await ctl.restoreDefaults();
    expect(res.steps).toBe(3);
    const rows = await prisma.needFinderStep.findMany({
      where: { id: { in: ["nfs-situation", "nfs-priority", "nfs-budget"] } },
      select: { id: true, active: true, options: { select: { id: true } } },
    });
    expect(rows.length).toBe(3);
    for (const r of rows) expect(r.active).toBe(true);
    expect(rows.find((r) => r.id === "nfs-budget")?.options.length).toBeGreaterThan(0);
  });
});
