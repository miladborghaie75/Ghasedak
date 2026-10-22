/**
 * گام ۱۶ — API عمومی ویزارد «چی لازم داری؟» (بند ۹+۲۰).
 *
 * قفل می‌کند:
 *  ۱) فقط گام‌ها/گزینه‌های active برمی‌گردند، با ترتیب sortOrder.
 *  ۲) rule به‌عنوان JSON همان شکلی است که فروشگاه انتظار دارد (بند ۲۰).
 *  ۳) DB خالی → fallback تک‌منبع از contracts (فروشگاه هرگز بدون ویزارد نیست).
 *  ۴) seed واقعی: سه گام با idهای پایدار و id گزینه‌های عمومی قبلی.
 */
import "reflect-metadata";
import { PrismaService } from "../src/prisma/prisma.service";
import { NeedFinderController } from "../src/catalog/need-finder.controller";
import { NEED_FINDER_FALLBACK } from "@ghasedak/contracts";

jest.setTimeout(120_000);

describe("Phase 16 — need-finder steps API", () => {
  let prisma: PrismaService;
  let ctl: NeedFinderController;
  const createdSteps: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    ctl = new NeedFinderController(prisma);
  });

  afterAll(async () => {
    // Cascade گزینه‌ها را هم می‌برد
    await prisma.needFinderStep.deleteMany({ where: { id: { in: createdSteps } } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("seed: سه گام با id پایدار، به‌ترتیب، با گزینه‌های active", async () => {
    const steps = await ctl.steps();
    expect(steps.map((s) => s.id)).toEqual(NEED_FINDER_FALLBACK.map((s) => s.id));
    for (const step of steps) {
      expect(step.question).toBeTruthy();
      expect(step.options.length).toBeGreaterThan(0);
      for (const o of step.options) {
        expect(typeof o.id).toBe("string");
        expect(typeof o.label).toBe("string");
        expect(o.icon === null || typeof o.icon === "string").toBe(true);
      }
    }
    // id گام ۱ همان اسلاگ‌های عمومی قبلی — لینک‌های /need?start=… و /search?need=… زنده‌اند
    expect(steps[0].options.map((o) => o.id)).toContain("sport");
    expect(steps[0].options.map((o) => o.id)).toContain("everyday");
  });

  it("rule: ساختار بند ۲۰ درست از DB می‌آید (categories/attributeTerms/priceMax)", async () => {
    const steps = await ctl.steps();
    const sport = steps[0].options.find((o) => o.id === "sport");
    expect(sport?.rule?.categories).toContain("sport");
    const budget300 = steps[2].options.find((o) => o.id === "budget-300");
    expect(budget300?.rule?.priceMax).toBe(300_000);
    // «مهم نیست» = بدون محدودیت → rule خالی
    const open = steps[2].options.find((o) => o.id === "budget-open");
    expect(open?.rule ?? null).toBeNull();
  });

  it("فقط active برمی‌گردد: گام خاموش و گزینهٔ خاموش هرگز دیده نمی‌شوند", async () => {
    const stepId = "nfs-t-inactive-step";
    createdSteps.push(stepId);
    await prisma.needFinderStep.create({
      data: {
        id: stepId,
        question: "گام خاموش تست",
        sortOrder: 999,
        active: false,
        options: { create: [{ id: "nfo-t-inactive-opt", label: "گزینه", sortOrder: 0, active: true }] },
      },
    });
    const activeStepId = "nfs-t-active-step";
    createdSteps.push(activeStepId);
    await prisma.needFinderStep.create({
      data: {
        id: activeStepId,
        question: "گام فعال تست",
        sortOrder: 998,
        active: true,
        options: {
          create: [
            { id: "nfo-t-on", label: "نمایش", sortOrder: 0, active: true, rule: { priceMax: 1 } },
            { id: "nfo-t-off", label: "خاموش", sortOrder: 1, active: false, rule: { priceMax: 2 } },
          ],
        },
      },
    });

    const steps = await ctl.steps();
    expect(steps.find((s) => s.id === stepId)).toBeUndefined();
    const mine = steps.find((s) => s.id === activeStepId);
    expect(mine?.options.map((o) => o.id)).toEqual(["nfo-t-on"]);
    expect(mine?.options[0].rule).toEqual({ priceMax: 1 });
  });

  it("DB خالی → fallback تک‌منبع از contracts (نه خطا، نه لیست خالی)", async () => {
    const empty = { needFinderStep: { findMany: jest.fn().mockResolvedValue([]) } };
    const ctlEmpty = new NeedFinderController(empty as unknown as PrismaService);
    const steps = await ctlEmpty.steps();
    expect(steps).toEqual(NEED_FINDER_FALLBACK);
    expect(steps).toHaveLength(3);
  });
});
