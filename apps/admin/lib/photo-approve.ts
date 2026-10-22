/**
 * منطقِ «تأییدِ گروهی» در برنامهٔ عکاسی — جدا از کامپوننت تا قابل تست باشد.
 *
 * چرا این سه تابع جدا شدند: انتخابِ چندتایی جایي است که راحت می‌شود اشتباه کرد —
 * کارِ تأییدشده در انتخاب بماند، بعد از تازه‌سازی، شناسهٔ کهنه به سرور برود، یا
 * پیامِ نتیجه بی‌دلیل خوش‌بینانه باشد. این‌ها همه منطقِ خالص‌اند و بدون رندر
 * قابل سنجش.
 */
import { PRIMARY_PHOTO_SHOT, type PhotoBulkApproveResult, type PhotoProgramBoard } from "@ghasedak/contracts";

/** یک کادرِ آمادهٔ تأیید — تنها چیزی که می‌شود انتخاب کرد */
export interface ApprovableShot {
  taskId: string;
  productId: string;
  productName: string;
  /** نامِ کادر — برای پیامِ تأیید */
  label: string;
  /** کادرِ اصلی: تأییدش عکسِ زندهٔ محصول را عوض می‌کند */
  primary: boolean;
}

/**
 * کادرهای قابلِ تأیید در کلِ تابلو (همهٔ دسته‌ها، نه فقط دستهٔ باز).
 *
 * فقط `SHOT` — یعنی عکسی هست و منتظرِ تأیید است. «در انتظارِ عکس» چیزی برای
 * تأیید ندارد، «تأیید شده» دوباره تأیید نمی‌خواهد و «عکسِ دوباره» یعنی عکس
 * برداشته شده؛ سزاوارِ تأیید نیست.
 */
export function approvableShots(board: PhotoProgramBoard | null): ApprovableShot[] {
  if (!board) return [];
  const out: ApprovableShot[] = [];
  for (const category of board.categories) {
    for (const product of category.products) {
      for (const shot of product.shots) {
        if (shot.status !== "SHOT" || !shot.taskId) continue;
        out.push({
          taskId: shot.taskId,
          productId: product.id,
          productName: product.name,
          label: shot.label,
          primary: shot.kind === PRIMARY_PHOTO_SHOT,
        });
      }
    }
  }
  return out;
}

/** افزودن/برداشتنِ یک کار از انتخاب — آرایهٔ تازه، بدون جهشِ ورودی */
export function toggleTask(selected: readonly string[], taskId: string): string[] {
  return selected.includes(taskId) ? selected.filter((id) => id !== taskId) : [...selected, taskId];
}

/** «همه» یا «هیچ» — دکمهٔ انتخابِ همه وقتی همه انتخاب شده‌اند، برمی‌دارد */
export function toggleAll(selected: readonly string[], all: readonly string[]): string[] {
  const everyChosen = all.length > 0 && all.every((id) => selected.includes(id));
  return everyChosen ? [] : [...all];
}

/**
 * پاک‌سازیِ انتخاب بعد از تازه‌سازیِ تابلو.
 *
 * چرا لازم است: بعد از تأیید، کار از `SHOT` بیرون می‌رود؛ اگر شناسه‌اش در
 * انتخاب بماند، دکمهٔ تأییدِ گروهی یک درخواستِ بی‌معنا می‌فرستد و پیامِ خطا
 * می‌دهد. هر شناسه‌ای که دیگر «آماده» نیست، از انتخاب می‌افتد.
 */
export function pruneSelection(selected: readonly string[], board: PhotoProgramBoard | null): string[] {
  const ready = new Set(approvableShots(board).map((s) => s.taskId));
  return selected.filter((id) => ready.has(id));
}

/**
 * پیامِ نتیجهٔ تأییدِ گروهی — صادقانه، با عددِ فارسی.
 *
 * سه حالتِ واقعی: همه تأیید شدند، بعضی نشدند، هیچ‌کدام نشدند. در حالتِ سوم
 * گفتنِ «۰ تأیید شد» بی‌فایده است؛ باید دلیلِ نخستین شکست را بگوید تا مدیر
 * بداند چه کاری لازم است.
 */
export function bulkApproveMessage(result: PhotoBulkApproveResult): string {
  const fa = (n: number) => n.toLocaleString("fa-IR");
  const firstError = result.failed[0]?.message;

  if (result.approved === 0) {
    return firstError ? `هیچ‌کدام تأیید نشد — ${firstError}` : "هیچ‌کدام تأیید نشد؛ بعداً دوباره تلاش کن.";
  }

  let text = `${fa(result.approved)} عکس تأیید شد`;
  if (result.live > 0) {
    text += `؛ ${fa(result.live)} عکسِ اصلیِ محصول شد و آرتِ جانشین کنار رفت`;
  }
  if (result.failed.length > 0) {
    text += `؛ ${fa(result.failed.length)} تأیید نشد — ${firstError ?? "دوباره تلاش کن"}`;
  }
  return `${text}.`;
}
