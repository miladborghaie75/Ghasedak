import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "crypto";
import { GL, GL_EQUITY } from "@ghasedak/contracts";
import { PrismaService } from "../prisma/prisma.service";
import type { PrismaTransaction } from "../common/tx";
import { assertCleanFields } from "../common/text-guard";
import { InventoryService } from "../inventory/inventory.service";
import { JournalService } from "../accounting/journal.service";
import { nextBarcodeForCategory } from "../products/barcode.util";
import {
  COLUMNS,
  COLUMN_LABELS,
  CsvParseError,
  mapHeader,
  normalizeKey,
  normalizePersian,
  parseCsv,
  parseMoneyCell,
  parseQtyCell,
  parseStatusCell,
  type ColumnKey,
  type CsvRecord,
} from "./csv-parse";

/**
 * ورود گروهی محصولات (گام ۱۳ · `[F1-3]`).
 *
 * سه قاعدهٔ سخت که این سرویس نباید بشکند:
 *  ۱) **پیش‌نمایش هیچ چیزی از محصولات را نمی‌نویسد.** تنها نوشتنِ preview،
 *     خودِ `ImportBatch` است تا Rollback و Audit معنا داشته باشد.
 *  ۲) **اعمال همه‌یا‌هیچ است.** یک تراکنش برای کل دسته؛ شکست یک ردیف یعنی
 *     هیچ ردیفی نوشته نشود و پیام، شمارهٔ همان سطر را بگوید.
 *  ۳) **موجودی فقط از مسیر انبار.** `InventoryService.moveInTx` با نوع
 *     `OPENING` — نوشتن مستقیم روی `stockQty` دفتر و پروجکشن را واگرا می‌کند.
 *
 * دربارهٔ «چرا createFull صدا زده نمی‌شود»: آن متد خودش `$transaction` باز
 * می‌کند و داخل تراکنشِ این سرویس قابل‌استفاده نیست. قواعد مهمش (گارد متن،
 * یکتایی SKU/بارکد، بارکد خودکار، OPENING از مسیر انبار، سند موجودی آغازین)
 * عیناً همین‌جا رعایت شده‌اند.
 */

export const IMPORT_MAX_ROWS = 5_000;
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;

type Action = "CREATE" | "UPDATE" | "SKIP" | "ERROR";

interface ProductSnapshot {
  name: string;
  slug: string;
  categoryId: string;
  brandId: string | null;
  status: string;
  basePrice: string;
  salePrice: string | null;
  costPrice: string | null;
}

interface VariantSnapshot {
  price: string;
  salePrice: string | null;
}

interface CreateAfter {
  sku: string;
  name: string;
  slug: string;
  categoryId: string;
  brandId: string | null;
  status: string;
  price: string;
  salePrice: string | null;
  costPrice: string | null;
  stock: number;
  barcode: string | null;
}

interface UpdateAfter {
  productId: string;
  variantId: string;
  product: ProductSnapshot;
  variant: VariantSnapshot;
}

interface UpdateBefore extends UpdateAfter {}

interface RowPlan {
  rowNo: number;
  action: Action;
  sku: string;
  entityId?: string | null;
  message?: string | null;
  before?: UpdateBefore;
  after?: CreateAfter | UpdateAfter;
}

export interface ImportPreviewRowView {
  id: string;
  rowNo: number;
  action: Action;
  sku: string;
  entityId: string | null;
  message: string | null;
  changes: Array<{ path: string; label: string; before: string | null; after: string | null }>;
}

/** برچسب فارسی فیلدهای قابل‌تغییر — UI و پیام‌ها از همین می‌خوانند */
const FIELD_LABELS: Record<string, string> = {
  "product.name": "نام محصول",
  "product.slug": "اسلاگ",
  "product.categoryId": "دسته",
  "product.brandId": "برند",
  "product.status": "وضعیت",
  "product.basePrice": "قیمت پایه",
  "product.salePrice": "قیمت حراج",
  "product.costPrice": "بهای خرید",
  "variant.price": "قیمت کالا",
  "variant.salePrice": "حراج کالا",
};

@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly journal: JournalService,
  ) {}

  // ------------------------------------------------------------- preview

  /**
   * پیش‌نمایش فایل — هر ردیف دقیقاً یک تصمیم می‌گیرد و هیچ محصولی نوشته نمی‌شود.
   */
  async preview(input: { filename?: string; text: string; actorId?: string; kind?: string }) {
    const kind = input.kind ?? "PRODUCTS";
    if (kind !== "PRODUCTS") {
      throw new BadRequestException({ code: "UNSUPPORTED_IMPORT_KIND", message: "این نوع ورود پشتیبانی نمی‌شود." });
    }
    const text = input.text ?? "";
    if (!text.trim()) {
      throw new BadRequestException({ code: "EMPTY_FILE", message: "فایل خالی است." });
    }
    if (Buffer.byteLength(text, "utf8") > IMPORT_MAX_BYTES) {
      throw new BadRequestException({
        code: "FILE_TOO_LARGE",
        message: `حجم فایل بیشتر از ${IMPORT_MAX_BYTES / 1024 / 1024} مگابایت است.`,
      });
    }

    let parsed;
    try {
      parsed = parseCsv(text);
    } catch (e) {
      if (e instanceof CsvParseError) {
        throw new BadRequestException({
          code: "CSV_PARSE_ERROR",
          message: `سطر ${e.row}: ${e.message}`,
        });
      }
      throw e;
    }
    if (parsed.rows.length === 0) {
      throw new BadRequestException({ code: "EMPTY_FILE", message: "فایل هیچ ردیف داده‌ای ندارد." });
    }
    if (parsed.rows.length > IMPORT_MAX_ROWS) {
      throw new BadRequestException({
        code: "TOO_MANY_ROWS",
        message: `تعداد ردیف‌ها (${parsed.rows.length}) از سقف ${IMPORT_MAX_ROWS} بیشتر است. فایل را تقسیم کنید.`,
      });
    }

    const headerMap = mapHeader(parsed.header);
    if (headerMap.index.sku === undefined) {
      throw new BadRequestException({
        code: "MISSING_SKU_COLUMN",
        message: "ستون SKU در فایل نیست. برای دیدن قالب درست، «دانلود قالب نمونه» را بزنید.",
      });
    }

    const cell = (rec: CsvRecord, key: ColumnKey): string => {
      const idx = headerMap.index[key];
      return idx === undefined ? "" : (rec.cells[idx] ?? "").trim();
    };

    // --- پیش‌بارگذاری برای اینکه هر ردیف به DB نزند
    const rawSkus = parsed.rows
      .map((r) => normalizePersian(cell(r, "sku")))
      .filter((s) => s.length > 0);
    const rawBarcodes = parsed.rows
      .map((r) => normalizePersian(cell(r, "barcode")))
      .filter((s) => s.length > 0);

    const [categories, brands, productList, variantsBySku, barcodeRows] = await Promise.all([
      this.prisma.category.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true, slug: true, parentId: true },
      }),
      this.prisma.brand.findMany({ where: { deletedAt: null }, select: { id: true, name: true, slug: true } }),
      this.prisma.product.findMany({
        where: { deletedAt: null },
        select: { id: true, slug: true },
      }),
      this.prisma.productVariant.findMany({
        where: { sku: { in: rawSkus } },
        include: { product: { select: { id: true, name: true, slug: true, categoryId: true, brandId: true, status: true, basePrice: true, salePrice: true, costPrice: true, publishedAt: true, deletedAt: true } } },
      }),
      this.prisma.productVariant.findMany({
        where: { barcode: { in: rawBarcodes } },
        select: { barcode: true, sku: true },
      }),
    ]);

    const variantBySku = new Map(variantsBySku.map((v) => [v.sku, v]));
    const slugOwner = new Map(productList.map((p) => [p.slug, p.id]));
    const barcodeOwner = new Map(
      barcodeRows.filter((b): b is { barcode: string; sku: string } => !!b.barcode).map((b) => [b.barcode, b.sku]),
    );
    const seen = new Map<string, number>();
    const plans: RowPlan[] = [];

    for (const rec of parsed.rows) {
      plans.push(
        this.evaluateRow(rec, cell, {
          categories,
          brands,
          variantBySku,
          slugOwner,
          barcodeOwner,
          seen,
        }),
      );
    }

    const counts = countPlans(plans);
    const previewHash = hashPlans(kind, plans);

    const batch = await this.prisma.importBatch.create({
      data: {
        kind,
        filename: input.filename?.trim() || "import.csv",
        actorId: input.actorId ?? null,
        status: "PREVIEWED",
        rowCount: plans.length,
        createCount: counts.CREATE,
        updateCount: counts.UPDATE,
        skipCount: counts.SKIP,
        errorCount: counts.ERROR,
        previewHash,
        rows: {
          create: plans.map((p) => ({
            rowNo: p.rowNo,
            action: p.action,
            entityId: p.entityId ?? null,
            sku: p.sku,
            ...(p.before ? { before: p.before as unknown as object } : {}),
            ...(p.after ? { after: p.after as unknown as object } : {}),
            message: p.message ?? null,
          })),
        },
      },
      include: { rows: { orderBy: { rowNo: "asc" } } },
    });

    return {
      batchId: batch.id,
      filename: batch.filename,
      previewHash,
      counts,
      rows: batch.rows.map((r) => toRowView(r, nameMaps(categories, brands))),
      unknownColumns: headerMap.unknown,
      limits: { maxRows: IMPORT_MAX_ROWS, maxBytes: IMPORT_MAX_BYTES },
    };
  }

  /**
   * ارزیابی یک ردیف — تصمیم صریح + دلیل.
   * برای SKU موجود، فقط فیلدهایی که در فایل آمده‌اند مقایسه می‌شوند؛
   * فیلد خالی یعنی «دست نزن»، نه «پاک کن» (پاک‌کردن با `-` صریح است).
   */
  private evaluateRow(
    rec: CsvRecord,
    cell: (rec: CsvRecord, key: ColumnKey) => string,
    ctx: {
      categories: Array<{ id: string; name: string; slug: string; parentId: string | null }>;
      brands: Array<{ id: string; name: string; slug: string }>;
      variantBySku: Map<string, { id: string; sku: string; barcode: string | null; price: bigint; salePrice: bigint | null; stockQty: number; product: { id: string; name: string; slug: string; categoryId: string; brandId: string | null; status: string; basePrice: bigint; salePrice: bigint | null; costPrice: bigint | null; publishedAt: Date | null; deletedAt: Date | null } }>;
      slugOwner: Map<string, string>;
      barcodeOwner: Map<string, string>;
      seen: Map<string, number>;
    },
  ): RowPlan {
    const rowNo = rec.rowNo;
    const skuRaw = cell(rec, "sku");
    const sku = normalizePersian(skuRaw).replace(/\s+/g, "");
    if (!sku) return { rowNo, action: "ERROR", sku: "", message: "ستون SKU خالی است." };

    const priorRow = ctx.seen.get(sku);
    if (priorRow !== undefined) {
      return { rowNo, action: "ERROR", sku, message: `SKU «${sku}» در سطر ${priorRow} همین فایل هم آمده است.` };
    }
    ctx.seen.set(sku, rowNo);

    const name = normalizePersian(cell(rec, "name"));
    const slug = normalizePersian(cell(rec, "slug"));
    const barcode = normalizePersian(cell(rec, "barcode"));
    const dirty = firstDirtyText({ "نام محصول": name, "اسلاگ": slug, "بارکد": barcode });
    if (dirty) return { rowNo, action: "ERROR", sku, message: dirty };

    const existing = ctx.variantBySku.get(sku);

    // ---------------------------------------------------------- SKU جدید
    if (!existing) {
      if (!name) return { rowNo, action: "ERROR", sku, message: "برای SKU جدید، ستون «نام محصول» الزامی است." };

      const price = parseMoneyCell(cell(rec, "price"));
      if (price === null) return { rowNo, action: "ERROR", sku, message: "برای SKU جدید، ستون «قیمت» الزامی است." };
      if (Number.isNaN(price) || price < 0) {
        return { rowNo, action: "ERROR", sku, message: `قیمت «${cell(rec, "price")}» عدد صحیح نامنفی تومان نیست.` };
      }
      const salePrice = parseMoneyCell(cell(rec, "sale_price"));
      if (Number.isNaN(salePrice)) return { rowNo, action: "ERROR", sku, message: "قیمت حراج عدد صحیح تومان نیست." };
      if (salePrice != null && salePrice > price) {
        return { rowNo, action: "ERROR", sku, message: "قیمت حراج نمی‌تواند از قیمت پایه بیشتر باشد." };
      }
      const costPrice = parseMoneyCell(cell(rec, "cost_price"));
      if (Number.isNaN(costPrice) || (costPrice != null && costPrice < 0)) {
        return { rowNo, action: "ERROR", sku, message: "بهای خرید عدد صحیح نامنفی تومان نیست." };
      }
      const stock = parseQtyCell(cell(rec, "stock"));
      if (Number.isNaN(stock)) return { rowNo, action: "ERROR", sku, message: "موجودی عدد صحیح نامنفی نیست." };

      const catRaw = cell(rec, "category");
      if (!catRaw) return { rowNo, action: "ERROR", sku, message: "برای SKU جدید، ستون «دسته» الزامی است." };
      const category = resolveNamed(ctx.categories, catRaw);
      if (!category) return { rowNo, action: "ERROR", sku, message: missingNameMessage("دسته", catRaw, ctx.categories) };

      const brandRaw = cell(rec, "brand");
      let brandId: string | null = null;
      if (brandRaw) {
        const brand = resolveNamed(ctx.brands, brandRaw);
        if (!brand) return { rowNo, action: "ERROR", sku, message: missingNameMessage("برند", brandRaw, ctx.brands) };
        brandId = brand.id;
      }

      const status = parseStatusCell(cell(rec, "status"));
      if (status === "INVALID") {
        return { rowNo, action: "ERROR", sku, message: "وضعیت باید DRAFT/PUBLISHED/ARCHIVED یا پیش‌نویس/منتشرشده/آرشیو باشد." };
      }

      if (barcode) {
        const owner = ctx.barcodeOwner.get(barcode);
        if (owner) return { rowNo, action: "ERROR", sku, message: `بارکد «${barcode}» قبلاً برای SKU «${owner}» ثبت شده است.` };
      }
      const finalSlug = slug || slugify(name);
      const slugOwner = ctx.slugOwner.get(finalSlug);
      if (slugOwner) {
        return { rowNo, action: "ERROR", sku, message: `اسلاگ «${finalSlug}» قبلاً برای محصول دیگری استفاده شده است.` };
      }

      const warning =
        (stock ?? 0) > 0 && costPrice == null
          ? "موجودی بدون بهای خرید ثبت می‌شود؛ سند حسابداری موجودی آغازین برای این ردیف زده نمی‌شود."
          : null;

      return {
        rowNo,
        action: "CREATE",
        sku,
        message: warning,
        after: {
          sku,
          name,
          slug: finalSlug,
          categoryId: category.id,
          brandId,
          status: status ?? "DRAFT",
          price: String(price),
          salePrice: salePrice != null ? String(salePrice) : null,
          costPrice: costPrice != null ? String(costPrice) : null,
          stock: stock ?? 0,
          barcode: barcode || null,
        },
      };
    }

    // ---------------------------------------------------------- SKU موجود
    const product = existing.product;
    if (product.deletedAt) {
      return { rowNo, action: "ERROR", sku, message: "محصول این SKU آرشیو شده است؛ بازگردانی آن از پنل محصولات انجام می‌شود." };
    }

    const before: UpdateBefore = {
      productId: product.id,
      variantId: existing.id,
      product: {
        name: product.name,
        slug: product.slug,
        categoryId: product.categoryId,
        brandId: product.brandId ?? null,
        status: product.status,
        basePrice: String(product.basePrice),
        salePrice: product.salePrice != null ? String(product.salePrice) : null,
        costPrice: product.costPrice != null ? String(product.costPrice) : null,
      },
      variant: {
        price: String(existing.price),
        salePrice: existing.salePrice != null ? String(existing.salePrice) : null,
      },
    };
    const after: UpdateAfter = {
      ...before,
      product: { ...before.product },
      variant: { ...before.variant },
    };
    const notes: string[] = [];

    if (name) after.product.name = name;
    if (slug) {
      if (slug !== before.product.slug) {
        const owner = ctx.slugOwner.get(slug);
        if (owner && owner !== product.id) {
          return { rowNo, action: "ERROR", sku, message: `اسلاگ «${slug}» قبلاً برای محصول دیگری استفاده شده است.` };
        }
      }
      after.product.slug = slug;
    }
    const catRaw = cell(rec, "category");
    if (catRaw) {
      const category = resolveNamed(ctx.categories, catRaw);
      if (!category) return { rowNo, action: "ERROR", sku, message: missingNameMessage("دسته", catRaw, ctx.categories) };
      after.product.categoryId = category.id;
    }
    const brandRaw = cell(rec, "brand");
    if (brandRaw) {
      const brand = resolveNamed(ctx.brands, brandRaw);
      if (!brand) return { rowNo, action: "ERROR", sku, message: missingNameMessage("برند", brandRaw, ctx.brands) };
      after.product.brandId = brand.id;
    }
    const status = parseStatusCell(cell(rec, "status"));
    if (status === "INVALID") {
      return { rowNo, action: "ERROR", sku, message: "وضعیت باید DRAFT/PUBLISHED/ARCHIVED یا پیش‌نویس/منتشرشده/آرشیو باشد." };
    }
    if (status) after.product.status = status;

    const priceRaw = cell(rec, "price");
    if (priceRaw) {
      const price = parseMoneyCell(priceRaw);
      if (price === null || Number.isNaN(price) || price < 0) {
        return { rowNo, action: "ERROR", sku, message: `قیمت «${priceRaw}» عدد صحیح نامنفی تومان نیست.` };
      }
      after.variant.price = String(price);
      after.product.basePrice = String(price);
    }
    const saleRaw = cell(rec, "sale_price");
    if (saleRaw) {
      if (saleRaw === "-") {
        after.variant.salePrice = null;
        after.product.salePrice = null;
      } else {
        const salePrice = parseMoneyCell(saleRaw);
        if (salePrice === null || Number.isNaN(salePrice)) {
          return { rowNo, action: "ERROR", sku, message: "قیمت حراج عدد صحیح تومان نیست (برای پاک‌کردن، `-` بگذارید)." };
        }
        after.variant.salePrice = String(salePrice);
        after.product.salePrice = String(salePrice);
      }
    }
    const costRaw = cell(rec, "cost_price");
    if (costRaw) {
      if (costRaw === "-") {
        after.product.costPrice = null;
      } else {
        const costPrice = parseMoneyCell(costRaw);
        if (costPrice === null || Number.isNaN(costPrice) || costPrice < 0) {
          return { rowNo, action: "ERROR", sku, message: "بهای خرید عدد صحیح نامنفی تومان نیست (برای پاک‌کردن، `-` بگذارید)." };
        }
        after.product.costPrice = String(costPrice);
      }
    }
    if (barcode && barcode !== existing.barcode) {
      notes.push("بارکد فقط برای SKU جدید نوشته می‌شود؛ ردیف موجود بارکدش تغییر نکرد.");
    }
    const stockRaw = cell(rec, "stock");
    if (stockRaw) {
      const stock = parseQtyCell(stockRaw);
      if (Number.isNaN(stock)) return { rowNo, action: "ERROR", sku, message: "موجودی عدد صحیح نامنفی نیست." };
      if (stock != null && stock !== existing.stockQty) {
        notes.push("موجودی SKU موجود از فایل تغییر نمی‌کند؛ تعدیل موجودی باید از انبارگردانی انجام شود.");
      }
    }

    const price = Number(after.variant.price);
    if (!Number.isSafeInteger(price) || price < 0) {
      return { rowNo, action: "ERROR", sku, message: "قیمت کالا نامعتبر است." };
    }
    if (after.variant.salePrice != null) {
      const sale = Number(after.variant.salePrice);
      if (!Number.isSafeInteger(sale) || sale < 0 || sale > price) {
        return { rowNo, action: "ERROR", sku, message: "قیمت حراج باید عدد صحیح بین ۰ تا قیمت کالا باشد." };
      }
    }

    const changes = diffSnapshots(before, after);
    if (changes.length === 0) {
      return {
        rowNo,
        action: "SKIP",
        sku,
        entityId: product.id,
        before,
        message: ["بدون تغییر نسبت به مقدار فعلی.", ...notes].join(" "),
      };
    }

    return {
      rowNo,
      action: "UPDATE",
      sku,
      entityId: product.id,
      before,
      after,
      message: notes.length ? notes.join(" ") : null,
    };
  }

  // ------------------------------------------------------------- apply

  /** اعمال دسته — پیش‌شرط‌ها صریح، همه‌یا‌هیچ در یک تراکنش. */
  async apply(batchId: string, actorId?: string) {
    const batch = await this.prisma.importBatch.findUnique({
      where: { id: batchId },
      include: { rows: { orderBy: { rowNo: "asc" } } },
    });
    if (!batch) throw new NotFoundException({ code: "NOT_FOUND", message: "دستهٔ ورود یافت نشد." });

    if (batch.status === "APPLIED") {
      return { batchId, alreadyApplied: true, counts: batchCounts(batch) };
    }
    if (batch.status === "REVERTED") {
      throw new ConflictException({ code: "BATCH_REVERTED", message: "این دسته قبلاً بازگردانده شده و دوباره اعمال نمی‌شود." });
    }
    if (batch.status === "FAILED") {
      throw new ConflictException({ code: "BATCH_FAILED", message: "این دسته پیش‌تر ناموفق بوده؛ فایل را دوباره پیش‌نمایش کنید." });
    }

    const errorRows = batch.rows.filter((r) => r.action === "ERROR");
    if (errorRows.length > 0) {
      throw new BadRequestException({
        code: "PREVIEW_HAS_ERRORS",
        message: `${errorRows.length} ردیف خطا دارد؛ تا رفع آن‌ها اعمال انجام نمی‌شود.`,
        fieldErrors: Object.fromEntries(errorRows.slice(0, 20).map((r) => [`ردیف ${r.rowNo}`, [r.message ?? "خطای نامشخص"]])),
      });
    }

    const recomputedHash = hashStoredRows(batch.kind, batch.rows);
    if (recomputedHash !== batch.previewHash) {
      throw new ConflictException({
        code: "PREVIEW_HASH_MISMATCH",
        message: "محتوای این پیش‌نمایش با هش ثبت‌شده نمی‌خواند؛ لطفاً فایل را دوباره پیش‌نمایش کنید.",
      });
    }

    // --- تازگی: وضعیت DB باید همان چیزی باشد که پیش‌نمایش دیده است
    for (const row of batch.rows) {
      if (row.action === "CREATE") {
        const dup = await this.prisma.productVariant.findUnique({ where: { sku: row.sku }, select: { sku: true } });
        if (dup) {
          throw new ConflictException({
            code: "PREVIEW_STALE",
            message: `SKU «${row.sku}» (سطر ${row.rowNo}) بعد از پیش‌نمایش ساخته شده است؛ پیش‌نمایش را تکرار کنید.`,
          });
        }
        continue;
      }
      if (row.action !== "UPDATE") continue;
      const before = row.before as unknown as UpdateBefore | null;
      if (!before) continue;
      const drift = await this.hasDrifted(before);
      if (drift) {
        throw new ConflictException({
          code: "PREVIEW_STALE",
          message: `SKU «${row.sku}» (سطر ${row.rowNo}) بعد از پیش‌نمایش تغییر کرده است (${drift})؛ پیش‌نمایش را تکرار کنید.`,
        });
      }
    }

    const result = await this.prisma.$transaction(async (tx) => {
      let created = 0;
      let updated = 0;
      for (const row of batch.rows) {
        if (row.action === "SKIP" || row.action === "ERROR") continue;
        if (row.action === "CREATE") {
          const after = row.after as unknown as CreateAfter;
          const entityId = await this.createInTx(tx, batch.id, after, actorId);
          await tx.importBatchRow.update({ where: { id: row.id }, data: { entityId, appliedAt: new Date() } });
          created += 1;
        } else if (row.action === "UPDATE") {
          const before = row.before as unknown as UpdateBefore;
          const after = row.after as unknown as UpdateAfter;
          await this.updateInTx(tx, before, after, row.sku, batch.id, actorId);
          await tx.importBatchRow.update({
            where: { id: row.id },
            data: { entityId: after.productId, appliedAt: new Date() },
          });
          updated += 1;
        }
      }
      await tx.importBatch.update({
        where: { id: batch.id },
        data: { status: "APPLIED", appliedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          actorId: actorId ?? null,
          action: "import.apply",
          entity: "ImportBatch",
          entityId: batch.id,
          newValues: {
            filename: batch.filename,
            created,
            updated,
            skipped: batch.skipCount,
            previewHash: batch.previewHash,
          },
        },
      });
      return { created, updated };
    });

    return {
      batchId,
      alreadyApplied: false,
      counts: {
        rowCount: batch.rowCount,
        CREATE: result.created,
        UPDATE: result.updated,
        SKIP: batch.skipCount,
        ERROR: 0,
      },
    };
  }

  /** ایجاد یک محصول کامل از ردیف — داخل تراکنش اعمال */
  private async createInTx(
    tx: PrismaTransaction,
    batchId: string,
    after: CreateAfter,
    actorId?: string,
  ): Promise<string> {
    assertCleanFields({ name: after.name, slug: after.slug });
    const category = await tx.category.findUnique({ where: { id: after.categoryId }, select: { id: true, slug: true, parentId: true } });
    if (!category) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: `دستهٔ ردیف «${after.sku}» دیگر وجود ندارد.` });
    }

    const slug = await this.uniqueSlug(tx, after.slug);
    const price = BigInt(after.price);
    const salePrice = after.salePrice != null ? BigInt(after.salePrice) : null;
    const costPrice = after.costPrice != null ? BigInt(after.costPrice) : null;

    const product = await tx.product.create({
      data: {
        name: after.name,
        slug,
        categoryId: category.id,
        brandId: after.brandId,
        basePrice: price,
        salePrice,
        costPrice,
        status: after.status as never,
        ...(after.status === "PUBLISHED" ? { publishedAt: new Date() } : {}),
      },
    });

    const barcode = after.barcode ?? (await nextBarcodeForCategory(tx, category.parentId ? null : category.slug, category.id));
    const variant = await tx.productVariant.create({
      data: {
        productId: product.id,
        sku: after.sku,
        barcode,
        price,
        salePrice,
        stockQty: 0,
        lowStockThreshold: 3,
      },
    });

    if (after.stock > 0) {
      const warehouse = await tx.warehouse.findFirst({
        where: { active: true },
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      });
      if (!warehouse) {
        throw new BadRequestException({ code: "VALIDATION_ERROR", message: "انبار فعال یافت نشد؛ ابتدا انبار بسازید." });
      }
      await this.inventory.moveInTx(tx, {
        warehouseId: warehouse.id,
        variantSku: variant.sku,
        type: "OPENING",
        qty: after.stock,
        unitCost: costPrice,
        refType: "import",
        refId: batchId,
        idempotencyKey: `import:${batchId}:${variant.sku}`,
        actorId,
        note: `موجودی آغازین از ورود گروهی (${batchId})`,
      });

      // همان قاعدهٔ مسیر فرم محصول: بدون بهای خرید، سند ساخته نمی‌شود (مبلغ ساختگی ممنوع)
      if (costPrice != null && costPrice > 0n) {
        await this.journal.postOrNotifyInTx(tx, {
          description: `موجودی آغازین از ورود گروهی — «${after.name}»`,
          sourceType: "opening_inventory",
          sourceId: `${batchId}:${variant.sku}`,
          actorId,
          lines: [
            { accountCode: GL.INVENTORY, debit: Number(BigInt(after.stock) * costPrice) },
            { accountCode: GL_EQUITY.RETAINED_EARNINGS, credit: Number(BigInt(after.stock) * costPrice) },
          ],
        });
      }
    }

    return product.id;
  }

  /** به‌روزرسانی فیلدهای مجاز یک SKU موجود — داخل تراکنش اعمال */
  private async updateInTx(
    tx: PrismaTransaction,
    before: UpdateBefore,
    after: UpdateAfter,
    sku: string,
    batchId: string,
    actorId?: string,
  ): Promise<void> {
    assertCleanFields({ name: after.product.name, slug: after.product.slug });

    const pd: Record<string, unknown> = {};
    if (after.product.name !== before.product.name) pd.name = after.product.name;
    if (after.product.slug !== before.product.slug) {
      const owner = await tx.product.findUnique({ where: { slug: after.product.slug }, select: { id: true } });
      if (owner && owner.id !== after.productId) {
        throw new BadRequestException({
          code: "DUPLICATE_SLUG",
          message: `اسلاگ «${after.product.slug}» برای محصول دیگری ثبت شده است.`,
        });
      }
      pd.slug = after.product.slug;
    }
    if (after.product.categoryId !== before.product.categoryId) pd.categoryId = after.product.categoryId;
    if (after.product.brandId !== before.product.brandId) pd.brandId = after.product.brandId;
    if (after.product.status !== before.product.status) {
      pd.status = after.product.status;
      if (after.product.status === "PUBLISHED") {
        const current = await tx.product.findUnique({ where: { id: after.productId }, select: { publishedAt: true } });
        if (!current?.publishedAt) pd.publishedAt = new Date();
      }
    }
    if (after.product.basePrice !== before.product.basePrice) pd.basePrice = BigInt(after.product.basePrice);
    if (after.product.salePrice !== before.product.salePrice) {
      pd.salePrice = after.product.salePrice != null ? BigInt(after.product.salePrice) : null;
    }
    if (after.product.costPrice !== before.product.costPrice) {
      pd.costPrice = after.product.costPrice != null ? BigInt(after.product.costPrice) : null;
    }

    const vd: Record<string, unknown> = {};
    if (after.variant.price !== before.variant.price) vd.price = BigInt(after.variant.price);
    if (after.variant.salePrice !== before.variant.salePrice) {
      vd.salePrice = after.variant.salePrice != null ? BigInt(after.variant.salePrice) : null;
    }

    if (Object.keys(pd).length === 0 && Object.keys(vd).length === 0) return;
    if (Object.keys(pd).length) await tx.product.update({ where: { id: after.productId }, data: pd });
    if (Object.keys(vd).length) await tx.productVariant.update({ where: { id: after.variantId }, data: vd });

    // اثر قیمت روی PriceHistory — فقط رکورد، هیچ محاسبه‌ای از آن نمی‌خواند (بند ۱۳)
    if (Object.keys(vd).length && after.variant.price !== before.variant.price) {
      const level = await tx.priceLevel.findFirst({ where: { code: "POS", active: true }, select: { id: true } });
      if (level) {
        await tx.priceHistory.create({
          data: {
            variantSku: sku,
            priceLevelId: level.id,
            oldPrice: BigInt(before.variant.price),
            newPrice: BigInt(after.variant.price),
            reason: `ورود گروهی ${batchId}`,
            actorId: actorId ?? null,
          },
        }).catch(() => undefined);
      }
    }
  }

  // ------------------------------------------------------------- revert

  /**
   * بازگردانی یک دسته — فقط آخرین دستهٔ هر SKU.
   *
   * «آخرین» یعنی هیچ دستهٔ APPLIED دیگری بعد از این، ردیفی روی همان SKU
   * نداشته باشد. دلیل: بازگرداندن دستهٔ قدیمی، تغییرات دستهٔ بعدی را با
   * مقادیر قدیمی‌تر بازنویسی می‌کند و نتیجه از هر دو حالت بدتر است.
   */
  async revert(batchId: string, actorId?: string) {
    const batch = await this.prisma.importBatch.findUnique({
      where: { id: batchId },
      include: { rows: { orderBy: { rowNo: "desc" } } },
    });
    if (!batch) throw new NotFoundException({ code: "NOT_FOUND", message: "دستهٔ ورود یافت نشد." });

    if (batch.status === "REVERTED") {
      return { batchId, alreadyReverted: true, reverted: { CREATE: 0, UPDATE: 0 } };
    }
    if (batch.status !== "APPLIED") {
      throw new ConflictException({ code: "NOT_APPLIED", message: "فقط دستهٔ اعمال‌شده قابل بازگردانی است." });
    }

    const skus = [...new Set(batch.rows.filter((r) => r.action === "CREATE" || r.action === "UPDATE").map((r) => r.sku))];
    const appliedAt = batch.appliedAt ?? batch.createdAt;
    const laterRows = await this.prisma.importBatchRow.findMany({
      where: {
        sku: { in: skus },
        batchId: { not: batch.id },
        batch: { status: "APPLIED", appliedAt: { gt: appliedAt } },
      },
      select: { sku: true },
      take: 50,
    });
    if (laterRows.length > 0) {
      const blocked = [...new Set(laterRows.map((r) => r.sku))];
      throw new ConflictException({
        code: "IMPORT_REVERT_NOT_LATEST",
        message: `برای این SKUها دستهٔ جدیدتری اعمال شده و بازگردانی ترتیبی را به‌هم می‌زند: ${blocked.slice(0, 10).join("، ")}`,
      });
    }

    // تغییرات بعدی روی همین ردیف‌ها → بازنویسی کورکورانه ممنوع
    for (const row of batch.rows) {
      if (row.action !== "UPDATE") continue;
      const after = row.after as unknown as UpdateAfter | null;
      if (!after) continue;
      const drifted = await this.hasDrifted(after);
      if (drifted) {
        throw new ConflictException({
          code: "IMPORT_REVERT_CONFLICT",
          message: `SKU «${row.sku}» بعد از اعمال تغییر کرده است (${drifted})؛ اول آن تغییر را بررسی کنید.`,
        });
      }
    }

    const reverted = await this.prisma.$transaction(async (tx) => {
      let creates = 0;
      let updates = 0;
      for (const row of batch.rows) {
        if (row.action === "CREATE") {
          const after = row.after as unknown as CreateAfter;
          await this.revertCreateInTx(tx, batch.id, after, actorId);
          creates += 1;
        } else if (row.action === "UPDATE") {
          const before = row.before as unknown as UpdateBefore;
          await this.updateInTx(tx, await this.currentSnapshot(tx, before), before, row.sku, `${batch.id}:revert`, actorId);
          // updateInTx انتظار «before → after» دارد؛ برای بازگردانی برعکس عمل می‌کنیم:
          // فعلی (after) به‌عنوان before و مقدار قبلی به‌عنوان after.
          updates += 1;
        }
      }
      await tx.importBatch.update({
        where: { id: batch.id },
        data: { status: "REVERTED", revertedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          actorId: actorId ?? null,
          action: "import.revert",
          entity: "ImportBatch",
          entityId: batch.id,
          newValues: { filename: batch.filename, revertedCreates: creates, revertedUpdates: updates },
        },
      });
      return { CREATE: creates, UPDATE: updates };
    });

    return { batchId, alreadyReverted: false, reverted };
  }

  private async revertCreateInTx(
    tx: PrismaTransaction,
    batchId: string,
    after: CreateAfter,
    actorId?: string,
  ): Promise<void> {
    const variant = await tx.productVariant.findUnique({
      where: { sku: after.sku },
      include: { product: { select: { id: true, deletedAt: true } } },
    });
    if (!variant) return;

    if (after.stock > 0) {
      const warehouse = await tx.warehouse.findFirst({
        where: { active: true },
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      });
      if (warehouse) {
        await this.inventory.moveInTx(
          tx,
          {
            warehouseId: warehouse.id,
            variantSku: after.sku,
            type: "CORRECTION",
            qty: after.stock,
            refType: "import_revert",
            refId: batchId,
            idempotencyKey: `import-revert:${batchId}:${after.sku}`,
            actorId,
            note: `برگشت موجودی آغازین ورود گروهی (${batchId})`,
          },
          false,
        );
      }
      if (after.costPrice != null && Number(after.costPrice) > 0) {
        const value = Number(BigInt(after.stock) * BigInt(after.costPrice));
        await this.journal.postOrNotifyInTx(tx, {
          description: `برگشت سند موجودی آغازین ورود گروهی — «${after.name}»`,
          sourceType: "opening_inventory_revert",
          sourceId: `${batchId}:${after.sku}`,
          actorId,
          lines: [
            { accountCode: GL_EQUITY.RETAINED_EARNINGS, debit: value },
            { accountCode: GL.INVENTORY, credit: value },
          ],
        });
      }
    }

    // حذف منطقی — محصول ممکن است در سفارش ارجاع شده باشد و حذف فیزیکی ممنوع است
    if (!variant.product.deletedAt) {
      await tx.product.update({ where: { id: variant.product.id }, data: { deletedAt: new Date() } });
    }
    await tx.productVariant.update({ where: { id: variant.id }, data: { deletedAt: new Date() } });
  }

  // ------------------------------------------------------------- read

  async get(batchId: string) {
    const batch = await this.prisma.importBatch.findUnique({
      where: { id: batchId },
      include: { rows: { orderBy: { rowNo: "asc" } } },
    });
    if (!batch) throw new NotFoundException({ code: "NOT_FOUND", message: "دستهٔ ورود یافت نشد." });

    // نام دسته/برند برای نمایش تفاوت‌ها (ستون‌های ذخیره‌شده شناسه‌اند، نه نام)
    const snapshots = batch.rows
      .map((r) => r.after as unknown as UpdateAfter | null)
      .filter((a): a is UpdateAfter => !!a && "product" in a);
    const categoryIds = [...new Set(snapshots.map((a) => a.product.categoryId))];
    const brandIds = [...new Set(snapshots.map((a) => a.product.brandId).filter((b): b is string => !!b))];
    const [cats, brands] = await Promise.all([
      this.prisma.category.findMany({ where: { id: { in: categoryIds } }, select: { id: true, name: true } }),
      this.prisma.brand.findMany({ where: { id: { in: brandIds } }, select: { id: true, name: true } }),
    ]);
    const names = {
      category: new Map(cats.map((c) => [c.id, c.name])),
      brand: new Map(brands.map((b) => [b.id, b.name])),
    };

    return {
      id: batch.id,
      filename: batch.filename,
      kind: batch.kind,
      status: batch.status,
      counts: batchCounts(batch),
      previewHash: batch.previewHash,
      createdAt: batch.createdAt,
      appliedAt: batch.appliedAt,
      revertedAt: batch.revertedAt,
      rows: batch.rows.map((r) => toRowView(r, names)),
    };
  }

  async list(limit = 10) {
    const rows = await this.prisma.importBatch.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(50, Math.max(1, limit)),
      select: {
        id: true, filename: true, status: true, rowCount: true, createCount: true,
        updateCount: true, skipCount: true, errorCount: true, createdAt: true, appliedAt: true, revertedAt: true,
      },
    });
    return { items: rows };
  }

  // ------------------------------------------------------------- helpers

  /** الگوی اسلاگ همان مسیر ساخت محصول */
  private async uniqueSlug(tx: PrismaTransaction, base: string): Promise<string> {
    const slug = slugify(base) || `import-${Date.now().toString(36)}`;
    let candidate = slug;
    for (let i = 0; i < 20; i++) {
      const dup = await tx.product.findUnique({ where: { slug: candidate }, select: { id: true } });
      if (!dup) return candidate;
      candidate = `${slug}-${i + 2}`;
    }
    return `${slug}-${Date.now().toString(36)}`;
  }

  /** آیا وضعیت فعلی DB با اسنپ‌شات «قبل» می‌خواند؟ خروجی: نام فیلد منحرف یا null */
  private async hasDrifted(snap: UpdateBefore | UpdateAfter): Promise<string | null> {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: snap.variantId },
      include: { product: { select: { name: true, slug: true, categoryId: true, brandId: true, status: true, basePrice: true, salePrice: true, costPrice: true } } },
    });
    if (!variant) return "کالا حذف شده است";
    const p = variant.product;
    if (p.name !== snap.product.name) return "نام";
    if (p.slug !== snap.product.slug) return "اسلاگ";
    if (p.categoryId !== snap.product.categoryId) return "دسته";
    if ((p.brandId ?? null) !== snap.product.brandId) return "برند";
    if (p.status !== snap.product.status) return "وضعیت";
    if (String(p.basePrice) !== snap.product.basePrice) return "قیمت پایه";
    if ((p.salePrice != null ? String(p.salePrice) : null) !== snap.product.salePrice) return "قیمت حراج";
    if ((p.costPrice != null ? String(p.costPrice) : null) !== snap.product.costPrice) return "بهای خرید";
    if (String(variant.price) !== snap.variant.price) return "قیمت کالا";
    if ((variant.salePrice != null ? String(variant.salePrice) : null) !== snap.variant.salePrice) return "حراج کالا";
    return null;
  }

  /** اسنپ‌شات فعلی (برای بازگردانی — before/after جای‌شان عوض می‌شود) */
  private async currentSnapshot(tx: PrismaTransaction, before: UpdateBefore): Promise<UpdateBefore> {
    const variant = await tx.productVariant.findUnique({
      where: { id: before.variantId },
      include: { product: { select: { id: true, name: true, slug: true, categoryId: true, brandId: true, status: true, basePrice: true, salePrice: true, costPrice: true } } },
    });
    if (!variant) {
      throw new ConflictException({ code: "IMPORT_REVERT_CONFLICT", message: "کالای این ردیف حذف شده است." });
    }
    const p = variant.product;
    return {
      productId: p.id,
      variantId: variant.id,
      product: {
        name: p.name,
        slug: p.slug,
        categoryId: p.categoryId,
        brandId: p.brandId ?? null,
        status: p.status,
        basePrice: String(p.basePrice),
        salePrice: p.salePrice != null ? String(p.salePrice) : null,
        costPrice: p.costPrice != null ? String(p.costPrice) : null,
      },
      variant: {
        price: String(variant.price),
        salePrice: variant.salePrice != null ? String(variant.salePrice) : null,
      },
    };
  }
}

// ------------------------------------------------------------------ helpers

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s\u200c]+/g, "-")
    .replace(/[^a-z0-9\u0600-\u06FF-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function resolveNamed<T extends { id: string; name: string; slug: string }>(list: T[], raw: string): T | null {
  const key = normalizeKey(raw);
  if (!key) return null;
  return (
    list.find((x) => normalizeKey(x.name) === key) ??
    list.find((x) => normalizeKey(x.slug) === key) ??
    null
  );
}

function missingNameMessage(kind: "دسته" | "برند", raw: string, list: Array<{ name: string }>): string {
  const suggestion = closestName(raw, list.map((x) => x.name));
  return suggestion
    ? `${kind} «${raw}» یافت نشد؛ نزدیک‌ترین نام موجود: «${suggestion}». برای ساخت ${kind} تازه از پنل استفاده کنید.`
    : `${kind} «${raw}» یافت نشد. برای ساخت ${kind} تازه از پنل استفاده کنید.`;
}

/** نزدیک‌ترین نام با فاصلهٔ لِوِنشتاین — فقط اگر واقعاً نزدیک باشد (نه پیشنهاد بی‌ربط) */
function closestName(raw: string, names: string[]): string | null {
  const target = normalizeKey(raw);
  let best: { name: string; dist: number } | null = null;
  for (const name of names) {
    const d = levenshtein(target, normalizeKey(name));
    if (!best || d < best.dist) best = { name, dist: d };
  }
  if (!best) return null;
  const threshold = Math.max(2, Math.ceil(target.length / 3));
  return best.dist <= threshold ? best.name : null;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

function firstDirtyText(fields: Record<string, string | null | undefined>): string | null {
  try {
    assertCleanFields(fields);
    return null;
  } catch (e) {
    const response = (e as { response?: { fieldErrors?: Record<string, string[]> } }).response;
    const first = Object.entries(response?.fieldErrors ?? {})[0];
    return first ? `${first[0]}: ${first[1][0]}` : "متن نامعتبر است.";
  }
}

function diffSnapshots(before: UpdateBefore, after: UpdateAfter) {
  const out: Array<{ path: string; label: string; before: string | null; after: string | null }> = [];
  const flat = (s: UpdateBefore | UpdateAfter): Record<string, string | null> => ({
    "product.name": s.product.name,
    "product.slug": s.product.slug,
    "product.categoryId": s.product.categoryId,
    "product.brandId": s.product.brandId,
    "product.status": s.product.status,
    "product.basePrice": s.product.basePrice,
    "product.salePrice": s.product.salePrice,
    "product.costPrice": s.product.costPrice,
    "variant.price": s.variant.price,
    "variant.salePrice": s.variant.salePrice,
  });
  const b = flat(before);
  const a = flat(after);
  for (const key of Object.keys(b)) {
    if ((b[key] ?? null) !== (a[key] ?? null)) {
      out.push({ path: key, label: FIELD_LABELS[key] ?? key, before: b[key], after: a[key] });
    }
  }
  return out;
}

function countPlans(plans: RowPlan[]) {
  return {
    rowCount: plans.length,
    CREATE: plans.filter((p) => p.action === "CREATE").length,
    UPDATE: plans.filter((p) => p.action === "UPDATE").length,
    SKIP: plans.filter((p) => p.action === "SKIP").length,
    ERROR: plans.filter((p) => p.action === "ERROR").length,
  };
}

function batchCounts(batch: { rowCount: number; createCount: number; updateCount: number; skipCount: number; errorCount: number }) {
  return {
    rowCount: batch.rowCount,
    CREATE: batch.createCount,
    UPDATE: batch.updateCount,
    SKIP: batch.skipCount,
    ERROR: batch.errorCount,
  };
}

/**
 * هشِ پیش‌نمایش — از محتوای تصمیم‌ها، نه از خود فایل (فایل ذخیره نمی‌شود).
 *
 * `stable()` اجباری است: ستون `Json` در پستگرس از نوع `JSONB` است و JSONB
 * ترتیب کلیدها را حفظ **نمی‌کند**. اگر هش را روی JSON.stringify خام بگیریم،
 * همان داده پس از رفت‌وبرگشت DB هش متفاوتی می‌دهد و هر اعمالی «دست‌کاری‌شده»
 * تشخیص داده می‌شود. پس هر دو طرف از نمایش متعارف (کلیدهای مرتب‌شده) هش می‌گیرند.
 */
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(obj).sort().map((k) => [k, stable(obj[k])]));
  }
  return value;
}

function hashPreview(
  kind: string,
  rows: Array<{ rowNo: number; sku: string; action: string; before?: unknown; after?: unknown }>,
): string {
  const canonical = {
    kind,
    rows: rows.map((r) => ({ rowNo: r.rowNo, sku: r.sku, action: r.action, before: r.before ?? null, after: r.after ?? null })),
  };
  return createHash("sha256").update(JSON.stringify(stable(canonical))).digest("hex");
}

function hashPlans(kind: string, plans: RowPlan[]): string {
  return hashPreview(kind, plans);
}

/** بازسازی همان هش از ردیف‌های ذخیره‌شده — تشخیص دست‌کاری دسته */
function hashStoredRows(
  kind: string,
  rows: Array<{ rowNo: number; sku: string; action: string; before: unknown; after: unknown }>,
): string {
  return hashPreview(kind, rows);
}

interface NameMaps {
  category: Map<string, string>;
  brand: Map<string, string>;
}

function nameMaps(
  categories: Array<{ id: string; name: string }>,
  brands: Array<{ id: string; name: string }>,
): NameMaps {
  return {
    category: new Map(categories.map((c) => [c.id, c.name])),
    brand: new Map(brands.map((b) => [b.id, b.name])),
  };
}

function toRowView(
  row: {
    id: string;
    rowNo: number;
    action: string;
    sku: string;
    entityId: string | null;
    message: string | null;
    before: unknown;
    after: unknown;
  },
  names?: NameMaps,
): ImportPreviewRowView {
  const before = row.before as unknown as UpdateBefore | null;
  const after = row.after as unknown as UpdateAfter | null;
  const changes =
    row.action === "UPDATE" && before && after
      ? diffSnapshots(before, after).map((c) => ({
          path: c.path,
          label: c.label,
          before: displayValue(c.path, c.before, names),
          after: displayValue(c.path, c.after, names),
        }))
      : [];
  return {
    id: row.id,
    rowNo: row.rowNo,
    action: row.action as Action,
    sku: row.sku,
    entityId: row.entityId,
    message: row.message,
    changes,
  };
}

const STATUS_FA: Record<string, string> = {
  DRAFT: "پیش‌نویس",
  PUBLISHED: "منتشرشده",
  ARCHIVED: "آرشیو",
};

function displayValue(path: string, value: string | null, names?: NameMaps): string | null {
  if (value == null) return null;
  if (path.endsWith("categoryId")) return names?.category.get(value) ?? value;
  if (path.endsWith("brandId")) return names?.brand.get(value) ?? value;
  if (path.endsWith("status")) return STATUS_FA[value] ?? value;
  return value;
}

export const IMPORT_COLUMN_LABELS = COLUMN_LABELS;
export const IMPORT_COLUMNS = COLUMNS;
