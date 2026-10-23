/**
 * مهاجرت صفحه‌های محتوایی به بلوک «صفحهٔ محتوایی» (`CONTENT_PAGE`).
 *
 * چرا لازم است؟ صفحه‌هایی که پیش از این بلوک با «ساخت صفحه از محتوای فعلی»
 * ساخته می‌شدند (درباره ما، تماس، قوانین، حریم، ارسال، بازگشت) به شکلِ
 * «هیرو + متن‌های پراکنده» درمی‌آمدند، در حالی که سایت همان صفحه‌ها را بدون
 * هیرو و با بخش‌های تیتردار نشان می‌دهد. نتیجه: صفحهٔ پنل با صفحهٔ سایت
 * یک شکل نبود.
 *
 * این اسکریپت هر شش صفحه را از **منبعِ مشترکِ متن** دوباره می‌سازد. سه قاعده:
 *  ۱) payload قبلی در `ContentRevision` می‌ماند — هیچ‌چیز پاک نمی‌شود؛
 *  ۲) وضعیت انتشار دست‌نخورده می‌ماند — صفحهٔ پیش‌نویس پیش‌نویس می‌ماند و
 *     صفحهٔ منتشرشده تا «انتشار» دستیِ مدیر، همان نسخهٔ قبل را سرو می‌کند؛
 *  ۳) صفحه‌ای که از قبل مدل تازه دارد دست‌نخورده می‌ماند (اجرای دوباره بی‌خطر) —
 *     استثنا: اگر عنوانِ صفحه **خودکار** باشد (عنوان و عنوانِ سئو یکی‌اند،
 *     یعنی دست مدیر نخورده) و با عنوانِ مرجع فرق کند، هم‌راستا می‌شود؛
 *     وگرنه صفحه‌ای که مدیر نامش را عوض کرده هرگز دست نمی‌خورد.
 *
 * اجرا: `pnpm --filter @ghasedak/database db:rebuild-content-pages`
 */
import { PrismaClient } from "@prisma/client";
import {
  normalizeCmsPage,
  SITE_CONTENT_PAGES,
  siteContentToCmsPage,
  sitePageBySlug,
} from "@ghasedak/contracts";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const lines: string[] = [];

  for (const [slug, content] of Object.entries(SITE_CONTENT_PAGES)) {
    const title = sitePageBySlug(slug)?.title ?? content.slug;
    const fresh = siteContentToCmsPage(content, title);
    const row = await prisma.cmsPage.findUnique({ where: { slug } });

    if (!row) {
      // صفحه هنوز ساخته نشده (روش‌های ارسال / شرایط بازگشت) → پیش‌نویس می‌سازیم
      await prisma.cmsPage.create({
        data: { slug, payload: fresh as object, status: "DRAFT", updatedBy: null },
      });
      lines.push(`  /${slug}: صفحهٔ تازه ساخته شد (پیش‌نویس)`);
      continue;
    }

    const current = normalizeCmsPage(row.payload);
    const hasModern = current.blocks.some((b) => b.type === "CONTENT_PAGE");

    if (hasModern) {
      // عنوانِ خودکار (عنوان و سئو یکی‌اند یعنی دست مدیر نخورده) با مرجع نمی‌خواند
      const autoTitle = (current.seo?.title ?? "") === current.title;
      if (!autoTitle || current.title === title) {
        lines.push(`  /${slug}: از قبل مدل تازه دارد — دست‌نخورده ماند`);
        continue;
      }
      await prisma.contentRevision.create({
        data: { entity: "CmsPage", entityId: slug, payload: (row.payload ?? {}) as object, actorId: null },
      });
      await prisma.cmsPage.update({
        where: { slug },
        data: {
          payload: { ...(current as object), title, seo: { ...(current.seo ?? {}), title } } as object,
          updatedBy: null,
        },
      });
      lines.push(`  /${slug}: عنوانِ خودکار با مرجع هم‌راستا شد («${current.title}» ← «${title}»)`);
      continue;
    }

    await prisma.contentRevision.create({
      data: { entity: "CmsPage", entityId: slug, payload: (row.payload ?? {}) as object, actorId: null },
    });
    await prisma.cmsPage.update({
      where: { slug },
      data: { payload: fresh as object, updatedBy: null },
    });
    lines.push(`  /${slug}: بازسازی شد (نسخهٔ قبل در نسخه‌ها) — وضعیت ${row.status} ماند`);
  }

  console.log("بازسازی صفحه‌های محتوایی:\n" + lines.join("\n"));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
