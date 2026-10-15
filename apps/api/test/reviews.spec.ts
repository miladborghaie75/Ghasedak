/**
 * گام ۱۱ (بند ۴۱) — چرخهٔ کامل نظرات روی rehearsal DB:
 *  OTP → توکن یک‌بارمصرف → ثبت PENDING → بج «خریدار واقعی» از سفارش PAID
 *  → ضدتکرار/توکن یک‌بارمصرف → تأیید/رد/پاسخ ادمین + AuditLog → نمایش عمومی بدون PII.
 *
 * نکته: OTP با createOtp ساخته می‌شود (کد واقعی DB) — بدون وابستگی به اپراتور SMS؛
 * سنجش ارسال واقعی (SENT/QUEUED) در تست‌های SMS موجود است (بند ۱۱۱).
 */
import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import { PrismaService } from "../src/prisma/prisma.service";
import { SmsProvidersService } from "../src/events/sms-providers.service";
import { ReviewsService, normalizeMobile } from "../src/reviews/reviews.service";

jest.setTimeout(120_000);

const MARK = Date.now().toString(36); // همهٔ دادهٔ تست با همین نشانه ساخته و پاک می‌شود
const slug = `test-review-${MARK}`;
const mobileA = `0990${String(Date.now()).slice(-6)}1`; // مهمان بدون خرید
const mobileB = `0991${String(Date.now()).slice(-6)}2`; // خریدار واقعی
const orderCode = `RVW-${MARK}`;

async function freshToken(svc: ReviewsService, mobile: string): Promise<string> {
  const code = await svc.createOtp(mobile);
  const { otpToken } = await svc.verifyOtp(mobile, code);
  return otpToken;
}

describe("Phase 11 — reviews module (OTP → submit → moderate → public)", () => {
  let prisma: PrismaService;
  let svc: ReviewsService;
  let productId: string;
  let variantId: string;
  let actorId: string; // کاربر واقعی — AuditLog.actorId FK به User دارد

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    svc = new ReviewsService(prisma, new SmsProvidersService(prisma));

    const cat = await prisma.category.create({
      data: { name: `تست-نظر-${MARK}`, slug: `test-review-cat-${MARK}` },
    });
    const product = await prisma.product.create({
      data: {
        name: `محصول تست نظر ${MARK}`,
        slug,
        status: "PUBLISHED",
        categoryId: cat.id,
        basePrice: 100_000n,
      },
    });
    productId = product.id;
    const variant = await prisma.productVariant.create({
      data: { productId, sku: `RVW-SKU-${MARK}`, price: 100_000n },
    });
    variantId = variant.id;
    const actor = await prisma.user.create({
      data: { name: `تست ادمین ${MARK}`, role: "SUPER_ADMIN" },
    });
    actorId = actor.id;
  });

  afterAll(async () => {
    // پاک‌سازی — فقط داده‌های همین اجرا (نشانه‌دار)
    const revs = await prisma.review.findMany({ where: { mobile: { in: [mobileA, mobileB] } }, select: { id: true } });
    if (revs.length) await prisma.auditLog.deleteMany({ where: { entity: "Review", entityId: { in: revs.map((r) => r.id) } } });
    await prisma.user.delete({ where: { id: actorId } });
    await prisma.review.deleteMany({ where: { mobile: { in: [mobileA, mobileB] } } });
    await prisma.otpCode.deleteMany({ where: { mobile: { in: [mobileA, mobileB] } } });
    await prisma.order.deleteMany({ where: { code: orderCode } }); // آیتم‌ها cascade می‌شوند
    const cat = await prisma.category.findUnique({ where: { slug: `test-review-cat-${MARK}` } });
    if (cat) {
      await prisma.product.deleteMany({ where: { slug } }); // review/variant cascade
      await prisma.category.delete({ where: { id: cat.id } });
    }
    await prisma.$disconnect();
  });

  it("normalizeMobile — فرم ۹۸… و ارقام فارسی را نرمال می‌کند", () => {
    expect(normalizeMobile("۰۹۹۰۱۲۳۴۵۶۷")).toBe("09901234567");
    expect(normalizeMobile("989901234567")).toBe("09901234567");
    expect(normalizeMobile("0990 123-4567")).toBe("09901234567");
  });

  it("چرخهٔ OTP: کد غلط رد می‌شود، کد درست توکن یک‌بارمصرف می‌دهد", async () => {
    await svc.createOtp(mobileA);
    await expect(svc.verifyOtp(mobileA, "000000")).rejects.toThrow(BadRequestException);
    // توکن فقط با کد درست صادر می‌شود
    const code = (await prisma.otpCode.findFirstOrThrow({
      where: { mobile: mobileA, purpose: "review" },
      orderBy: { createdAt: "desc" },
    })).code;
    const { otpToken } = await svc.verifyOtp(mobileA, code);
    expect(otpToken).toBeTruthy();
  });

  it("ثبت نظر → PENDING؛ بدون سفارش پرداخت‌شده بج «خریدار واقعی» نمی‌گیرد", async () => {
    const token = await freshToken(svc, mobileA);
    const r = await svc.submit({ slug, rating: 4, body: "کیفیت دوخت خیلی خوب بود و فرمش هم مناسب است.", name: "میترا", mobile: mobileA, otpToken: token });
    expect(r.status).toBe("PENDING");
    expect(r.isVerifiedPurchase).toBe(false);
  });

  it("توکن یک‌بارمصرف است — استفادهٔ مجدد رد می‌شود (حتی با دادهٔ جدید)", async () => {
    const token = await freshToken(svc, mobileA);
    await expect(
      svc.submit({ slug, rating: 5, body: "یک متن دوباره برای تست مصرف توکن است.", mobile: mobileA, otpToken: token }),
    ).rejects.toThrow(BadRequestException);
  });

  it("ضدتکرار: یک نظر بر موبایل×محصول — دوبلیکت خطای صریح می‌دهد", async () => {
    const token = await freshToken(svc, mobileA);
    await expect(
      svc.submit({ slug, rating: 5, body: "این نظر تکراری است و باید رد شود.", mobile: mobileA, otpToken: token }),
    ).rejects.toThrow(BadRequestException);
  });

  it("بج خریدار واقعی: سفارش PAID با همان موبایل و همان محصول → تأیید", async () => {
    await prisma.order.create({
      data: {
        code: orderCode,
        guestMobile: mobileB,
        addressSnapshot: {},
        paymentStatus: "PAID",
        subtotal: 100_000n,
        shippingCost: 0n,
        total: 100_000n,
        items: {
          create: [{ variantId, titleSnapshot: "تست", qty: 1, unitPrice: 100_000n, lineTotal: 100_000n }],
        },
      },
    });
    const token = await freshToken(svc, mobileB);
    const r = await svc.submit({ slug, rating: 5, body: "خریدم و واقعاً راضی بودم؛ اندازه‌اش دقیق بود.", mobile: mobileB, otpToken: token });
    expect(r.status).toBe("PENDING");
    expect(r.isVerifiedPurchase).toBe(true);
  });

  it("نمایش عمومی قبل از تأیید خالی است (هیچ PENDING عمومی نیست)", async () => {
    const pub = await svc.publicForProduct(slug);
    expect(pub.found).toBe(true);
    expect(pub.items).toHaveLength(0);
    expect(pub.summary?.count).toBe(0);
  });

  it("تأیید ادمین → AuditLog + انتشار در نمایش عمومی با خلاصهٔ صحیح", async () => {
    const revs = await prisma.review.findMany({ where: { productId, status: "PENDING" }, orderBy: { createdAt: "asc" } });
    expect(revs).toHaveLength(2);
    const first = await svc.moderate(revs[0].id, "approve", actorId);
    expect(first.status).toBe("APPROVED");

    const audit = await prisma.auditLog.findFirst({ where: { entity: "Review", entityId: revs[0].id, action: "review.approve" } });
    expect(audit?.actorId).toBe(actorId);
    expect((audit?.oldValues as { status?: string })?.status).toBe("PENDING");
    expect((audit?.newValues as { status?: string })?.status).toBe("APPROVED");

    const pub = await svc.publicForProduct(slug);
    expect(pub.items).toHaveLength(1);
    expect(pub.summary?.count).toBe(1);
    expect(pub.summary?.avg).toBe(revs[0].rating);
    // PII: هیچ موبایلی در پاسخ عمومی نیست
    const raw = JSON.stringify(pub);
    expect(raw).not.toContain(mobileA);
    expect(raw).not.toContain(mobileB);
  });

  it("پاسخ ادمین منتشر می‌شود؛ رد کامل نظر را از عمومی حذف می‌کند", async () => {
    const approved = (await prisma.review.findFirstOrThrow({ where: { productId, status: "APPROVED" } })).id;
    const replied = await svc.moderate(approved, "reply", actorId, { reply: "ممنون از بازخوردتان!" });
    expect(replied.adminReply).toBe("ممنون از بازخوردتان!");

    const pending = (await prisma.review.findFirstOrThrow({ where: { productId, status: "PENDING" } })).id;
    await svc.moderate(pending, "reject", actorId);

    const pub = await svc.publicForProduct(slug);
    expect(pub.items).toHaveLength(1);
    expect(pub.items[0].adminReply).toBe("ممنون از بازخوردتان!");
    expect(pub.summary?.count).toBe(1);
  });

  it("صف ادمین: شمارنده‌های وضعیت درست‌اند و ردیف شامل موبایل برای پنل است", async () => {
    const q = await svc.queue({ status: "REJECTED", page: 1 });
    expect(q.counts.REJECTED).toBeGreaterThanOrEqual(1);
    expect(q.counts.PENDING).toBe(0);
    const row = q.items.find((i) => i.mobile === mobileB);
    expect(row).toBeTruthy();
  });

  it("اعتبارسنجی: امتیاز/متن نامعتبر → fieldErrors؛ توکن بدون OTP رد می‌شود", async () => {
    await expect(
      svc.submit({ slug, rating: 9, body: "کم", mobile: mobileA, otpToken: "" }),
    ).rejects.toThrow(BadRequestException);
    const token = await freshToken(svc, mobileA);
    await expect(
      svc.submit({ slug, rating: 0, body: "x", mobile: "123", otpToken: token }),
    ).rejects.toThrow(BadRequestException);
    // توکن سالم اما موبایل متفاوت → توکن متعلق به آن موبایل نیست
    await expect(
      svc.submit({ slug, rating: 5, body: "متن معتبر برای موبایل متفاوت و توکن ناهماهنگ.", mobile: `0992${String(Date.now()).slice(-6)}3`, otpToken: token }),
    ).rejects.toThrow(BadRequestException);
  });

  it("محصول ناموجود/درافت: نمایش عمومی found=false و ثبت خطا می‌دهد", async () => {
    const pub = await svc.publicForProduct(`no-such-${MARK}`);
    expect(pub.found).toBe(false);
    expect(pub.summary).toBeNull();
    const token = await freshToken(svc, mobileA);
    await expect(
      svc.submit({ slug: `no-such-${MARK}`, rating: 5, body: "متن معتبر برای محصول ناموجود.", mobile: mobileA, otpToken: token }),
    ).rejects.toThrow(BadRequestException);
  });
});
