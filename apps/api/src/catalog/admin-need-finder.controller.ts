import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import { NEED_FINDER_FALLBACK, type NeedRule } from "@ghasedak/contracts";
import { PrismaService } from "../prisma/prisma.service";
import { RequirePermission } from "../auth/permissions.guard";
import { Identity } from "../auth/identity.decorator";
import type { AdminIdentity } from "../auth/auth.service";
import { assertCleanFields } from "../common/text-guard";

/**
 * شناسهٔ پایدار لاتین — همان چیزی که در آدرس نتیجه (`/need/result?a0=sport`)
 * و لینک‌های `/need?start=…` می‌نشیند. عمداً فقط حروف کوچک/عدد/خط تیره:
 * شناسهٔ پایدارِ اشتراک‌پذیر نباید فاصله یا کاراکتر نیازمند انکود داشته باشد.
 */
const ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

const RULE_KEYS = new Set(["categories", "attributeTerms", "priceMax", "why"]);

function invalid(message: string, fieldErrors?: Record<string, string[]>): never {
  throw new BadRequestException({ code: "VALIDATION_ERROR", message, fieldErrors });
}

function assertStableId(value: string): string {
  const id = String(value ?? "").trim();
  if (!ID_RE.test(id)) {
    invalid("شناسهٔ پایدار نامعتبر است — فقط حروف کوچک لاتین، عدد و خط تیره.", {
      id: ["مثال درست: sport یا budget-300"],
    });
  }
  return id;
}

/** شناسهٔ خودکار وقتی ادمین چیزی وارد نکرده — پایدار نیست اما یگانه است */
function autoId(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 6)}`;
}

/** آرایهٔ رشته‌های غیرخالی و یکتا از ورودی (ترتیب حفظ می‌شود) */
function stringList(raw: unknown, field: string): string[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    invalid("قاعدهٔ ویزارد نامعتبر است.", { [field]: ["باید فهرست باشد."] });
  }
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || !item.trim()) {
      invalid("قاعدهٔ ویزارد نامعتبر است.", { [field]: ["هر آیتم باید متن غیرخالی باشد."] });
    }
    const v = item.trim();
    if (!out.includes(v)) out.push(v);
  }
  return out.length ? out : undefined;
}

/**
 * نرمال‌سازی قاعدهٔ انطباق (بند ۲۰) — تنها دروازهٔ ورود rule به DB.
 *
 * چرا این‌جا و نه در UI: قاعده مستقیم روی کوئری فروشگاه اثر می‌گذارد؛ شکل
 * خراب (مثلاً priceMax رشته یا کلید ناشناخته) یعنی ویزارد بی‌صدا خالی/غلط
 * می‌شود. پس کلید ناشناخته و نوع غلط با خطای روشن رد می‌شوند، نه sanitize.
 * خروجی null یعنی «بدون محدودیت» — همان معنای گزینهٔ «مهم نیست».
 */
export function normalizeNeedRule(raw: unknown): NeedRule | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    invalid("قاعده باید یک شیء باشد یا خالی بماند.");
  }
  const input = raw as Record<string, unknown>;
  const unknownKeys = Object.keys(input).filter((k) => !RULE_KEYS.has(k));
  if (unknownKeys.length) {
    invalid("قاعده شامل کلید ناشناخته است.", {
      rule: [`کلیدهای مجاز: categories, attributeTerms, priceMax, why — ناشناخته: ${unknownKeys.join(", ")}`],
    });
  }

  const rule: NeedRule = {};
  const categories = stringList(input.categories, "categories");
  if (categories) rule.categories = categories;
  const attributeTerms = stringList(input.attributeTerms, "attributeTerms");
  if (attributeTerms) rule.attributeTerms = attributeTerms;

  if (input.priceMax !== undefined && input.priceMax !== null) {
    const priceMax = input.priceMax;
    if (typeof priceMax !== "number" || !Number.isInteger(priceMax) || priceMax <= 0) {
      invalid("سقف بودجه باید عدد صحیح مثبت (تومان) باشد.", {
        priceMax: ["مثال: 300000"],
      });
    }
    rule.priceMax = priceMax;
  }

  if (input.why !== undefined && input.why !== null) {
    if (typeof input.why !== "string") {
      invalid("متن دلیل باید رشته باشد.", { why: ["متن ساده"] });
    }
    const why = input.why.trim();
    if (why) {
      assertCleanFields({ why });
      rule.why = why;
    }
  }

  return Object.keys(rule).length ? rule : null;
}

/**
 * API ادمین ویزارد «چی لازم داری؟» (گام ۱۶) — CRUD گام‌ها و گزینه‌ها،
 * ویرایش قاعدهٔ انطباق، ترتیب و فعال/غیرفعال.
 *
 * مبنا: همان جدول‌هایی که API عمومی می‌خواند (`NeedFinderStep/Option`)، پس
 * هر تغییری این‌جا بی‌واسطه در فروشگاه دیده می‌شود (با TTL کش ۶۰ ثانیه‌ای).
 * خواندن با `marketing.view`، هر نوشتن با `marketing.manage` (بند ۷).
 */
@Controller("admin/need-finder")
export class AdminNeedFinderController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Audit بدون استثنا، ولی شکست‌ناپذیر — ثبت لاگ نباید ویرایش را بیندازد */
  private async audit(
    actorId: string | undefined,
    action: string,
    entity: string,
    entityId: string,
    values?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: actorId ?? null,
          action,
          entity,
          entityId,
          newValues: (values ?? {}) as object,
        },
      });
    } catch {
      // بی‌صدا — لاگ ممیزی نباید کار ادمین را بشکند
    }
  }

  /**
   * واژگان قاعده — دسته‌ها و ترم‌های ویژگی از DB.
   *
   * چرا لازم است: قاعدهٔ انطباق مستقیماً روی کوئری فروشگاه اثر می‌گذارد. اگر
   * ادمین دسته/جنس را از حافظه تایپ کند، یک حرف غلط یعنی گزینه‌ای که هیچ‌وقت
   * محصولی نشان نمی‌دهد و هیچ‌کس هم نمی‌فهمد چرا. پس فرم قاعده از همین فهرست
   * انتخاب می‌کند و همین فهرست دروازهٔ اعتبارسنجی است.
   */
  @Get("vocabulary")
  @RequirePermission("marketing.view")
  async vocabulary() {
    const [categories, attributes] = await Promise.all([
      this.prisma.category.findMany({
        where: { deletedAt: null },
        orderBy: { sortOrder: "asc" },
        select: { slug: true, name: true, status: true },
      }),
      this.prisma.attribute.findMany({
        orderBy: { name: "asc" },
        select: {
          slug: true,
          name: true,
          isFilterable: true,
          terms: {
            orderBy: { sortOrder: "asc" },
            select: { id: true, slug: true, value: true },
          },
        },
      }),
    ]);
    return {
      categories: categories.map((c) => ({ slug: c.slug, name: c.name, status: c.status })),
      attributes: attributes.map((a) => ({
        slug: a.slug,
        name: a.name,
        isFilterable: a.isFilterable,
        terms: a.terms.map((t) => ({ id: t.id, slug: t.slug, value: t.value })),
      })),
    };
  }

  /**
   * بررسی اینکه قاعده به دادهٔ واقعی کاتالوگ می‌خورد — دسته/جنس ناشناخته خطاست.
   *
   * قاعدهٔ ذخیره‌شده همان چیزی است که فروشگاه می‌سنجد؛ پس دسته یا جنسی که در
   * کاتالوگ نیست یعنی گزینهٔ مرده. اینجا با خطای روشن رد می‌شود (نه بی‌صدا).
   */
  private async assertRuleMatchesCatalog(rule: NeedRule | null): Promise<void> {
    if (!rule) return;
    if (rule.categories?.length) {
      const found = await this.prisma.category.findMany({
        where: { slug: { in: rule.categories }, deletedAt: null },
        select: { slug: true },
      });
      const known = new Set(found.map((c) => c.slug));
      const unknown = rule.categories.filter((c) => !known.has(c));
      if (unknown.length) {
        invalid("قاعده به دسته‌ای اشاره می‌کند که در کاتالوگ نیست.", {
          categories: [`دستهٔ ناشناخته: ${unknown.join("، ")}`],
        });
      }
    }
    if (rule.attributeTerms?.length) {
      const terms = await this.prisma.attributeTerm.findMany({
        where: {
          OR: [{ slug: { in: rule.attributeTerms } }, { id: { in: rule.attributeTerms } }],
        },
        select: { id: true, slug: true },
      });
      const known = new Set<string>();
      for (const t of terms) {
        known.add(t.slug);
        known.add(t.id);
      }
      const unknown = rule.attributeTerms.filter((t) => !known.has(t));
      if (unknown.length) {
        invalid("قاعده به جنسی اشاره می‌کند که در ویژگی‌های کاتالوگ نیست.", {
          attributeTerms: [`جنس ناشناخته: ${unknown.join("، ")}`],
        });
      }
    }
  }

  /** همهٔ گام‌ها با گزینه‌ها — شامل خاموش‌ها (ادمین باید بتواند روشن کند) */
  @Get("steps")
  @RequirePermission("marketing.view")
  async list() {
    const rows = await this.prisma.needFinderStep.findMany({
      orderBy: { sortOrder: "asc" },
      include: { options: { orderBy: { sortOrder: "asc" } } },
    });
    return {
      items: rows.map((s) => ({
        id: s.id,
        question: s.question,
        sortOrder: s.sortOrder,
        active: s.active,
        options: s.options.map((o) => ({
          id: o.id,
          stepId: o.stepId,
          label: o.label,
          icon: o.icon,
          rule: (o.rule as NeedRule | null) ?? null,
          sortOrder: o.sortOrder,
          active: o.active,
        })),
      })),
    };
  }

  @Post("steps")
  @RequirePermission("marketing.manage")
  async createStep(
    @Body() body: { question?: string; id?: string; sortOrder?: number; active?: boolean },
    @Identity() actor?: AdminIdentity | null,
  ) {
    const question = body.question?.trim();
    if (!question) invalid("پرسش گام الزامی است.", { question: ["پرسش را بنویسید."] });
    assertCleanFields({ question });
    const id = body.id?.trim() ? assertStableId(body.id) : autoId("nfs");
    if (await this.prisma.needFinderStep.findUnique({ where: { id } })) {
      invalid("گامی با این شناسه از قبل هست.", { id: ["شناسهٔ دیگری بگذارید."] });
    }
    const count = await this.prisma.needFinderStep.count();
    const created = await this.prisma.needFinderStep.create({
      data: { id, question, sortOrder: body.sortOrder ?? count, active: body.active ?? true },
    });
    await this.audit(actor?.userId, "need-finder.step.create", "NeedFinderStep", id, { question });
    return created;
  }

  @Patch("steps/:id")
  @RequirePermission("marketing.manage")
  async updateStep(
    @Param("id") id: string,
    @Body() body: { question?: string; sortOrder?: number; active?: boolean },
    @Identity() actor?: AdminIdentity | null,
  ) {
    const before = await this.prisma.needFinderStep.findUnique({ where: { id } });
    if (!before) throw new NotFoundException({ code: "NOT_FOUND", message: "گام ویزارد پیدا نشد." });
    const data: Record<string, unknown> = {};
    if (body.question !== undefined) {
      const question = body.question.trim();
      if (!question) invalid("پرسش گام نمی‌تواند خالی باشد.", { question: ["پرسش را بنویسید."] });
      assertCleanFields({ question });
      data.question = question;
    }
    if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;
    if (body.active !== undefined) data.active = body.active;
    const updated = await this.prisma.needFinderStep.update({ where: { id }, data });
    await this.audit(actor?.userId, "need-finder.step.update", "NeedFinderStep", id, {
      before: { question: before.question, sortOrder: before.sortOrder, active: before.active },
      after: { question: updated.question, sortOrder: updated.sortOrder, active: updated.active },
    });
    return updated;
  }

  @Delete("steps/:id")
  @RequirePermission("marketing.manage")
  async deleteStep(@Param("id") id: string, @Identity() actor?: AdminIdentity | null) {
    const step = await this.prisma.needFinderStep.findUnique({
      where: { id },
      include: { _count: { select: { options: true } } },
    });
    if (!step) throw new NotFoundException({ code: "NOT_FOUND", message: "گام ویزارد پیدا نشد." });
    await this.prisma.needFinderStep.delete({ where: { id } }); // گزینه‌ها Cascade می‌روند
    await this.audit(actor?.userId, "need-finder.step.delete", "NeedFinderStep", id, {
      question: step.question,
      options: step._count.options,
    });
    return { ok: true };
  }

  /**
   * بازگردانی گام‌های پیش‌فرض از تک‌منبع contracts (همان دادهٔ seed).
   * upsert است، پس گام‌های دلخواه ادمین دست‌نخورده می‌مانند و اجرای دوباره
   * بی‌آزار است. کاربرد اصلی: وقتی همهٔ گام‌ها حذف شده‌اند و فروشگاه ناچار
   * به fallback پناه برده — ادمین پیش‌فرض‌ها را به DB برمی‌گرداند تا ویرایش‌پذیر شوند.
   */
  @Post("restore-defaults")
  @RequirePermission("marketing.manage")
  async restoreDefaults(@Identity() actor?: AdminIdentity | null) {
    for (const [si, step] of NEED_FINDER_FALLBACK.entries()) {
      await this.prisma.needFinderStep.upsert({
        where: { id: step.id },
        update: { question: step.question, sortOrder: si, active: true },
        create: { id: step.id, question: step.question, sortOrder: si, active: true },
      });
      for (const [oi, opt] of step.options.entries()) {
        // پیش‌فرض‌ها هم باید به کاتالوگ بخورند — وگرنه گزینه‌ای می‌سازیم که هیچ‌وقت
        // محصولی نشان نمی‌دهد
        await this.assertRuleMatchesCatalog(opt.rule ?? null);
        await this.prisma.needFinderOption.upsert({
          where: { id: opt.id },
          update: {
            stepId: step.id,
            label: opt.label,
            icon: opt.icon,
            sortOrder: oi,
            active: true,
            rule: (opt.rule ?? undefined) as never,
          },
          create: {
            id: opt.id,
            stepId: step.id,
            label: opt.label,
            icon: opt.icon,
            sortOrder: oi,
            active: true,
            rule: (opt.rule ?? undefined) as never,
          },
        });
      }
    }
    await this.audit(actor?.userId, "need-finder.restore-defaults", "NeedFinderStep", "defaults", {
      steps: NEED_FINDER_FALLBACK.length,
    });
    return { ok: true, steps: NEED_FINDER_FALLBACK.length };
  }

  /**
   * ترتیب کامل گام‌ها یا گزینه‌های یک گام را یک‌جا می‌نویسد.
   *
   * چرا یک endpoint جدا و نه sortOrder تکی: با PATCH تکی، اگر درخواست وسط
   * راه قطع شود نیم‌ترتیب می‌ماند و دو آیتم هم‌ترتیب (ترتیب نامعین) می‌شوند.
   * این‌جا فهرست باید **کامل** باشد و در یک تراکنش نوشته می‌شود.
   */
  @Post("reorder")
  @RequirePermission("marketing.manage")
  async reorder(
    @Body() body: { kind?: string; ids?: unknown },
    @Identity() actor?: AdminIdentity | null,
  ) {
    if (body.kind !== "step" && body.kind !== "option") {
      invalid("نوع ترتیب‌دهی نامعتبر است.", { kind: ["step یا option"] });
    }
    const ids = body.ids;
    if (!Array.isArray(ids) || !ids.length || ids.some((i) => typeof i !== "string")) {
      invalid("فهرست شناسه‌ها برای ترتیب‌دهی نامعتبر است.", { ids: ["فهرست غیرخالی از شناسه"] });
    }
    const list = ids as string[];
    if (body.kind === "step") {
      const total = await this.prisma.needFinderStep.count();
      const found = await this.prisma.needFinderStep.count({ where: { id: { in: list } } });
      if (found !== list.length || list.length !== total) {
        invalid("فهرست گام‌ها باید کامل و بدون تکرار باشد.", { ids: [`${list.length} از ${total} گام`] });
      }
      await this.prisma.$transaction(
        list.map((id, i) =>
          this.prisma.needFinderStep.update({ where: { id }, data: { sortOrder: i } }),
        ),
      );
    } else {
      const rows = await this.prisma.needFinderOption.findMany({
        where: { id: { in: list } },
        select: { stepId: true },
      });
      if (rows.length !== list.length) {
        invalid("برخی گزینه‌های فهرست پیدا نشدند.", { ids: ["فهرست را از نو بارگذاری کنید."] });
      }
      const stepId = rows[0]?.stepId;
      const siblings = await this.prisma.needFinderOption.count({ where: { stepId } });
      if (rows.some((r) => r.stepId !== stepId) || list.length !== siblings) {
        invalid("ترتیب فقط بین گزینه‌های یک گام ممکن است و فهرست باید کامل باشد.", {
          ids: ["ترتیب‌دهی گزینه‌ها درون یک گام انجام می‌شود."],
        });
      }
      await this.prisma.$transaction(
        list.map((id, i) =>
          this.prisma.needFinderOption.update({ where: { id }, data: { sortOrder: i } }),
        ),
      );
    }
    await this.audit(actor?.userId, `need-finder.${body.kind}.reorder`, "NeedFinderStep", body.kind, {
      ids: list,
    });
    return { ok: true, count: list.length };
  }

  /** گزینهٔ جدید یک گام — id اختیاری ولی اگر داده شود پایدار و تغییرناپذیر است */
  @Post("steps/:stepId/options")
  @RequirePermission("marketing.manage")
  async createOption(
    @Param("stepId") stepId: string,
    @Body() body: { id?: string; label?: string; icon?: string | null; rule?: unknown; sortOrder?: number; active?: boolean },
    @Identity() actor?: AdminIdentity | null,
  ) {
    if (!(await this.prisma.needFinderStep.findUnique({ where: { id: stepId } }))) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "گام ویزارد پیدا نشد." });
    }
    const label = body.label?.trim();
    if (!label) invalid("متن گزینه الزامی است.", { label: ["متن گزینه را بنویسید."] });
    assertCleanFields({ label });
    const id = body.id?.trim() ? assertStableId(body.id) : autoId("opt");
    if (await this.prisma.needFinderOption.findUnique({ where: { id } })) {
      invalid("گزینه‌ای با این شناسه از قبل هست.", { id: ["شناسهٔ دیگری بگذارید."] });
    }
    const icon = this.normalizeIcon(body.icon);
    const rule = normalizeNeedRule(body.rule);
    await this.assertRuleMatchesCatalog(rule);
    const count = await this.prisma.needFinderOption.count({ where: { stepId } });
    const created = await this.prisma.needFinderOption.create({
      data: {
        id,
        stepId,
        label,
        icon,
        sortOrder: body.sortOrder ?? count,
        active: body.active ?? true,
        rule: (rule ?? undefined) as never,
      },
    });
    await this.audit(actor?.userId, "need-finder.option.create", "NeedFinderOption", id, {
      stepId,
      label,
      rule,
    });
    return created;
  }

  /** ویرایش گزینه — شناسه تغییر نمی‌کند (لینک‌های /need/result?… زنده بمانند) */
  @Patch("options/:id")
  @RequirePermission("marketing.manage")
  async updateOption(
    @Param("id") id: string,
    @Body() body: { label?: string; icon?: string | null; rule?: unknown; sortOrder?: number; active?: boolean },
    @Identity() actor?: AdminIdentity | null,
  ) {
    const before = await this.prisma.needFinderOption.findUnique({ where: { id } });
    if (!before) throw new NotFoundException({ code: "NOT_FOUND", message: "گزینهٔ ویزارد پیدا نشد." });
    const data: Record<string, unknown> = {};
    if (body.label !== undefined) {
      const label = body.label.trim();
      if (!label) invalid("متن گزینه نمی‌تواند خالی باشد.", { label: ["متن گزینه را بنویسید."] });
      assertCleanFields({ label });
      data.label = label;
    }
    if ("icon" in body) data.icon = this.normalizeIcon(body.icon);
    // rule: نبودِ کلید = دست‌نزن؛ null = پاک‌کردن (گزینهٔ «مهم نیست»)
    if ("rule" in body) {
      const rule = normalizeNeedRule(body.rule);
      await this.assertRuleMatchesCatalog(rule);
      data.rule = (rule ?? null) as never;
    }
    if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;
    if (body.active !== undefined) data.active = body.active;
    const updated = await this.prisma.needFinderOption.update({ where: { id }, data });
    await this.audit(actor?.userId, "need-finder.option.update", "NeedFinderOption", id, {
      before: { label: before.label, icon: before.icon, rule: before.rule, active: before.active },
      after: { label: updated.label, icon: updated.icon, rule: updated.rule, active: updated.active },
    });
    return updated;
  }

  @Delete("options/:id")
  @RequirePermission("marketing.manage")
  async deleteOption(@Param("id") id: string, @Identity() actor?: AdminIdentity | null) {
    const before = await this.prisma.needFinderOption.findUnique({ where: { id } });
    if (!before) throw new NotFoundException({ code: "NOT_FOUND", message: "گزینهٔ ویزارد پیدا نشد." });
    await this.prisma.needFinderOption.delete({ where: { id } });
    await this.audit(actor?.userId, "need-finder.option.delete", "NeedFinderOption", id, {
      stepId: before.stepId,
      label: before.label,
    });
    return { ok: true };
  }

  /** آیکون گزینه: ایموجی کوتاه یا خالی — رشتهٔ بلند/BOM/کنترل‌کاراکتر رد می‌شود */
  private normalizeIcon(raw: string | null | undefined): string | null {
    if (raw === undefined || raw === null) return null;
    if (typeof raw !== "string") invalid("آیکون باید متن باشد.", { icon: ["مثلاً 🏃‍♀️"] });
    const icon = raw.trim();
    if (!icon) return null;
    if (icon.length > 16) invalid("آیکون بیش از حد بلند است.", { icon: ["یک ایموجی کوتاه"] });
    assertCleanFields({ icon });
    return icon;
  }
}
