/**
 * فیکسچر تست بصری کارت گرید — **فقط برای تست/CI؛ بخشی از seed دمو نیست**.
 *
 * چرا جدا: تست هندسهٔ کارت باید هم‌زمان یک کارت «امتیازدار» و یک کارت «بی‌امتیاز»
 * در یک لیست ببیند؛ seed دمو عمداً «بدون نظر جعلی» است (بند ۹۶)، پس این فیکسچر
 * صریحاً به‌عنوان دادهٔ تست و با نام‌های مشخص‌شده ساخته می‌شود.
 *
 * idempotent است: اجرای چندباره چیزی تکراری نمی‌سازد (کلید = slug و id نظر).
 * پیش‌نیاز: migration + `db:seed` (دسته و برند از seed می‌آیند).
 *
 * اجرا:  node packages/database/scripts/visual-fixture.mjs
 * خروجی: خلاصهٔ وضعیت با کد خروج غیرصفر در صورت شکست (برای CI).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const CATEGORY_SLUG = process.env.VISUAL_CATEGORY_SLUG ?? "bra";
const BRAND_SLUG = process.env.VISUAL_BRAND_SLUG ?? "ghasedak-demo";
const PRICE = 250_000n;

const FIXTURES = [
  { slug: "visual-fixture-rated", name: "محصول تست — کارت امتیازدار", sku: "VFX-RATED-75", reviewId: "visual-fixture-review-rated", rating: 5 },
  { slug: "visual-fixture-unrated", name: "محصول تست — کارت بی‌امتیاز", sku: "VFX-UNRATED-75", reviewId: null, rating: null },
];

const log = (m) => console.log(`[visual-fixture] ${m}`);

async function termId(attributeSlug, termSlug) {
  const attr = await prisma.attribute.findUnique({ where: { slug: attributeSlug } });
  if (!attr) return null;
  const term = await prisma.attributeTerm.findUnique({
    where: { attributeId_slug: { attributeId: attr.id, slug: termSlug } },
  });
  return term?.id ?? null;
}

async function ensureProduct(f, ctx) {
  const existing = await prisma.product.findUnique({ where: { slug: f.slug } });
  if (existing) {
    log(`موجود بود: ${f.slug} (${existing.status})`);
    return { product: existing, created: false };
  }
  // ترم‌های رنگ/سایز اگر در seed باشند وصل می‌شوند تا ردیف سواچ/سایز هم مثل واقعیت رندر شود
  const terms = [ctx.colorTermId, ctx.sizeTermId].filter(Boolean).map((attributeTermId) => ({ attributeTermId }));
  const product = await prisma.product.create({
    data: {
      name: f.name,
      slug: f.slug,
      shortDescription: "دادهٔ فیکسچر تست بصری (نه دمو) — برای سنجش هندسهٔ کارت گرید.",
      status: "PUBLISHED",
      categoryId: ctx.categoryId,
      brandId: ctx.brandId,
      basePrice: PRICE,
      publishedAt: new Date(),
      variants: {
        create: [{ sku: f.sku, price: PRICE, stockQty: 5, ...(terms.length ? { terms: { create: terms } } : {}) }],
      },
    },
  });
  log(`ساخته شد: ${f.slug} (variant ${f.sku}، موجودی ۵)`);
  return { product, created: true };
}

async function ensureReview(f, productId) {
  if (!f.reviewId) return { created: false };
  const existing = await prisma.review.findUnique({ where: { id: f.reviewId } });
  if (existing) return { created: false };
  await prisma.review.create({
    data: {
      id: f.reviewId,
      productId,
      rating: f.rating,
      body: "دادهٔ تست بصری — این نظر برای سنجش نمایش «کارت امتیازدار در کنار کارت بی‌امتیاز» ساخته شده است.",
      name: "داده تست (visual)",
      mobile: null,
      status: "APPROVED",
      isVerifiedPurchase: false,
    },
  });
  return { created: true };
}

async function main() {
  const category = await prisma.category.findUnique({ where: { slug: CATEGORY_SLUG } });
  if (!category) {
    throw new Error(`دستهٔ «${CATEGORY_SLUG}» پیدا نشد — اول migration و db:seed را اجرا کن.`);
  }
  const brand = await prisma.brand.findUnique({ where: { slug: BRAND_SLUG } });
  if (!brand) {
    throw new Error(`برند «${BRAND_SLUG}» پیدا نشد — اول db:seed را اجرا کن.`);
  }
  const ctx = {
    categoryId: category.id,
    brandId: brand.id,
    colorTermId: await termId("color", "مشکی"),
    sizeTermId: await termId("size", "75"),
  };

  for (const f of FIXTURES) {
    const { product } = await ensureProduct(f, ctx);
    const review = await ensureReview(f, product.id);
    const approved = await prisma.review.count({ where: { productId: product.id, status: "APPROVED" } });
    log(
      `${f.slug}: دسته=${CATEGORY_SLUG} · نظر تأییدشده=${approved}` +
        `${review.created ? " (نظر فیکسچر ساخته شد)" : ""}`,
    );
  }

  const published = await prisma.product.count({
    where: { categoryId: category.id, status: "PUBLISHED", deletedAt: null },
  });
  log(`دستهٔ «${CATEGORY_SLUG}» اکنون ${published} محصول منتشرشده دارد — آمادهٔ تست هندسهٔ کارت.`);
}

main()
  .catch((e) => {
    console.error(`[visual-fixture] شکست: ${e.message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
