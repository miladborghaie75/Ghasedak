/**
 * گام ۱۷ — ترتیب قاب‌های آرت از ذخیره تا رندر، روی DB واقعی.
 *
 * چرا DB-محور: مدیر در صفحه‌ساز ترتیب شش قاب را با کشیدن عوض می‌کند، ولی همان
 * ترتیب باید از سه دروازهٔ واقعی رد شود:
 *   ۱) نوشتنِ `payload` پیش‌نویس در جدول CmsPage،
 *   ۲) اسنپ‌شاتِ انتشار (`publishedPayload`) — تنها چیزی که مشتری می‌بیند،
 *   ۳) مسیرِ خواندنِ فروشگاه + `resolveArtFrames` که شمارهٔ فارسیِ هر قاب را از
 *      ایندکس می‌سازد.
 * اگر یکی از این‌ها ترتیب را مرتب/بازچینش کند، مدیر در پنل یک چیدمان می‌بیند و
 * مشتری چیدمان دیگری — و هیچ تستِ ساختگی (stubbed) این را نشان نمی‌دهد.
 *
 * دادهٔ این تست فقط در DB آزمایشی (rehearsal) ساخته و پاک می‌شود؛ گاردِ
 * jest.setup اجازهٔ اجرا روی Production را نمی‌دهد.
 *
 * اجرا:  DATABASE_URL="postgresql://postgres:<pw>@127.0.0.1:<port>/<rehearsal-db>" \
 *          pnpm --filter @ghasedak/api test -- phase17-cms-art-order-db
 */
import "reflect-metadata";
import { CmsService } from "../src/cms/cms.controller";
import { PrismaService } from "../src/prisma/prisma.service";
import { resolveArtFrames, type CmsPageData } from "@ghasedak/contracts";
import type { AdminIdentity } from "../src/auth/auth.service";

jest.setTimeout(120_000);

/** چیدمانی که مدیر «کشیده» — هیچ‌کدام با ترتیب پیش‌فرض برند یکی نیست */
const PULLED_ORDER = ["sleepwear", "set", "bra", "panty", "sport", "shapewear"];
/** چیدمان دوم برای آزمونِ «پیش‌نویس تازه، سایتِ منتشرشده» */
const SECOND_ORDER = ["panty", "bra", "set", "sport", "shapewear", "sleepwear"];

const framesOf = (order: string[]) =>
  order.map((kind) => ({ kind, color: "primary", label: "", note: "", badge: "" }));

const pageWith = (order: string[]): CmsPageData =>
  ({
    version: 1,
    title: "تست ترتیب قاب‌ها",
    seo: { title: "تست ترتیب قاب‌ها", description: "" },
    blocks: [{ id: "b_order", type: "ART_SHOWCASE", props: { frames: framesOf(order) } }],
  }) as unknown as CmsPageData;

/** همان کاری که بلوکِ فروشگاه می‌کند: props → شش قابِ قطعی، به همان ترتیب */
function renderedKinds(page: CmsPageData): string[] {
  const block = page.blocks.find((b) => b.type === "ART_SHOWCASE");
  if (!block) throw new Error("بلوک ART_SHOWCASE در صفحه نیست");
  return resolveArtFrames(block.props.frames).map((f) => f.kind);
}

describe("Phase 17 — ترتیب قاب‌های آرت: ذخیره → انتشار → رندر (DB واقعی)", () => {
  let prisma: PrismaService;
  let cms: CmsService;
  const slug = `cms-order-${Date.now().toString(36)}`;
  const admin = { userId: "u-order", permissions: ["marketing.view"] } as unknown as AdminIdentity;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    cms = new CmsService(prisma);
    await prisma.cmsPage.deleteMany({ where: { slug } });
  });

  afterAll(async () => {
    await prisma.contentRevision.deleteMany({ where: { entity: "CmsPage", entityId: slug } }).catch(() => undefined);
    await prisma.auditLog.deleteMany({ where: { entity: "CmsPage", entityId: slug } }).catch(() => undefined);
    await prisma.cmsPage.deleteMany({ where: { slug } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("ذخیره: ترتیبِ کشیده‌شده در payload همان‌طور نوشته می‌شود (نه ترتیب پیش‌فرض برند)", async () => {
    const saved = await cms.save(slug, pageWith(PULLED_ORDER), undefined);
    expect(saved.status).toBe("DRAFT");
    expect(renderedKinds(saved.data)).toEqual(PULLED_ORDER);

    const row = await prisma.cmsPage.findUniqueOrThrow({ where: { slug } });
    const rows = (row.payload as { blocks: Array<{ props: { frames: Array<{ kind: string }> } }> }).blocks[0].props
      .frames;
    expect(rows.map((r) => r.kind)).toEqual(PULLED_ORDER);
    // صفحهٔ پیش‌نویس برای عموم دیده نمی‌شود
    expect(await cms.getPublic(slug, false, null)).toBeNull();
  });

  it("انتشار: اسنپ‌شات منتشرشده همان ترتیب را دارد و رندر فروشگاه هم همان را می‌دهد", async () => {
    await cms.publish(slug, undefined);
    const row = await prisma.cmsPage.findUniqueOrThrow({ where: { slug } });
    expect(row.status).toBe("PUBLISHED");
    // اسنپ‌شات، نه فقط پیش‌نویس
    const snap = row.publishedPayload as { blocks: Array<{ props: { frames: Array<{ kind: string }> } }> };
    expect(snap.blocks[0].props.frames.map((f) => f.kind)).toEqual(PULLED_ORDER);

    const pub = await cms.getPublic(slug, false, null);
    expect(pub?.preview).toBe(false);
    expect(renderedKinds(pub!.data)).toEqual(PULLED_ORDER);
    // شش فرمِ برند، هر کدام یک‌بار — جابه‌جایی چیزی را گم یا تکرار نکرده
    expect(new Set(renderedKinds(pub!.data)).size).toBe(6);
  });

  it("پیش‌نویسِ بعد از انتشار: سایت همچنان ترتیب منتشرشده را نشان می‌دهد، پیش‌نمایش ترتیب تازه را", async () => {
    await cms.save(slug, pageWith(SECOND_ORDER), undefined);

    const pub = await cms.getPublic(slug, false, null);
    expect(renderedKinds(pub!.data)).toEqual(PULLED_ORDER);

    const preview = await cms.getPublic(slug, true, admin);
    expect(preview?.preview).toBe(true);
    expect(renderedKinds(preview!.data)).toEqual(SECOND_ORDER);

    // انتشار دوباره چیدمان تازه را زنده می‌کند — کشیدنِ مدیر تا سایت می‌رسد
    await cms.publish(slug, undefined);
    const after = await cms.getPublic(slug, false, null);
    expect(renderedKinds(after!.data)).toEqual(SECOND_ORDER);
  });
});
