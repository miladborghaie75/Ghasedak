/**
 * تستِ منطقِ تأییدِ گروهی — انتخاب، پاک‌سازی و متنِ نتیجه.
 *
 * اجرا:  pnpm --filter @ghasedak/admin test
 *
 * چرا مهم است: تأییدِ گروهی چند عکس را هم‌زمان «زنده» می‌کند. اگر انتخاب شاملِ
 * کاری باشد که آماده نیست، یا پیام بگوید «همه تأیید شد» در حالی که یکی نشده،
 * مدیر بر اساسِ اطلاعاتِ نادرست تصمیم می‌گیرد.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { PhotoProgramBoard, PhotoProgramShot } from "@ghasedak/contracts";
import { approvableShots, bulkApproveMessage, pruneSelection, toggleAll, toggleTask } from "./photo-approve.ts";

const shot = (
  kind: string,
  status: PhotoProgramShot["status"],
  taskId: string | null,
): PhotoProgramShot => ({
  kind: kind as PhotoProgramShot["kind"],
  label: `کادر ${kind}`,
  required: true,
  status,
  mediaId: status === "PENDING" || status === "NEEDS_RETAKE" ? null : `m-${taskId}`,
  mediaUrl: null,
  note: null,
  live: false,
  taskId,
});

function board(products: Array<{ id: string; name: string; shots: PhotoProgramShot[] }>): PhotoProgramBoard {
  const categories = [
    {
      slug: "bra",
      label: "سوتین",
      priority: 1,
      notes: [],
      shots: [],
      products: products.map((p) => ({
        id: p.id,
        slug: p.id,
        name: p.name,
        category: "bra",
        categoryLabel: "سوتین",
        status: "PUBLISHED" as const,
        primaryImage: null,
        shots: p.shots,
        done: 0,
        total: p.shots.length,
        percent: 0,
      })),
      done: 0,
      total: 0,
      percent: 0,
    },
  ];
  return {
    categories,
    overall: {
      done: 0,
      total: 0,
      percent: 0,
      byStatus: { PENDING: 0, SHOT: 0, NEEDS_RETAKE: 0, APPROVED: 0 },
      productsWithArt: 0,
      productsTotal: products.length,
    },
  };
}

test("فقط کادرهای «عکس گرفته شد» قابلِ انتخاب‌اند — از همهٔ دسته‌ها و محصول‌ها", () => {
  const b = board([
    { id: "p1", name: "سوتین آ", shots: [shot("FLAT_FRONT", "SHOT", "t1"), shot("FLAT_BACK", "PENDING", null)] },
    { id: "p2", name: "ست ب", shots: [shot("FLAT_FRONT", "NEEDS_RETAKE", null), shot("COLORS", "SHOT", "t2")] },
    { id: "p3", name: "گن ج", shots: [shot("FLAT_FRONT", "APPROVED", "t3")] },
  ]);
  const ready = approvableShots(b);
  assert.deepEqual(
    ready.map((s) => s.taskId),
    ["t1", "t2"],
  );
  // کادرِ اصلی از نوعش شناخته می‌شود، نه از جای آن در فهرست
  assert.equal(ready[0].primary, true);
  assert.equal(ready[1].primary, false);
  // نامِ محصول همراه می‌آید تا پیامِ خطا بتواند بگوید کدام کار نشد
  assert.equal(ready[0].productName, "سوتین آ");
});

test("تابلوی خالی چیزی برای انتخاب ندارد", () => {
  assert.deepEqual(approvableShots(null), []);
  assert.deepEqual(approvableShots(board([])), []);
});

test("انتخاب/برداشتن، آرایهٔ تازه می‌دهد و ورودی را دست نمی‌زند", () => {
  const base = ["a"];
  assert.deepEqual(toggleTask(base, "b"), ["a", "b"]);
  assert.deepEqual(toggleTask(base, "a"), []);
  assert.deepEqual(base, ["a"]);
});

test("«انتخاب همه» وقتی همه انتخاب شده‌اند، همه را برمی‌دارد", () => {
  const all = ["a", "b"];
  assert.deepEqual(toggleAll([], all), ["a", "b"]);
  assert.deepEqual(toggleAll(["a"], all), ["a", "b"]);
  assert.deepEqual(toggleAll(["a", "b"], all), []);
  assert.deepEqual(toggleAll(["x"], []), []);
});

test("بعد از تازه‌سازی، شناسه‌های تأییدشده از انتخاب می‌افتند", () => {
  const b = board([{ id: "p1", name: "سوتین", shots: [shot("FLAT_FRONT", "SHOT", "t1"), shot("FLAT_BACK", "APPROVED", "t2")] }]);
  assert.deepEqual(pruneSelection(["t1", "t2", "gone"], b), ["t1"]);
});

test("پیامِ نتیجه: همه تأیید شدند، بعضی نشدند، هیچ‌کدام نشدند", () => {
  assert.equal(bulkApproveMessage({ approved: 3, live: 0, failed: [] }), "۳ عکس تأیید شد.");

  const withLive = bulkApproveMessage({ approved: 2, live: 1, failed: [] });
  assert.match(withLive, /۲ عکس تأیید شد/);
  assert.match(withLive, /۱ عکسِ اصلیِ محصول شد/);

  const partial = bulkApproveMessage({
    approved: 2,
    live: 0,
    failed: [{ taskId: "t9", message: "عکسی ثبت نشده است." }],
  });
  assert.match(partial, /۲ عکس تأیید شد/);
  assert.match(partial, /۱ تأیید نشد/);
  assert.match(partial, /عکسی ثبت نشده است/);

  assert.equal(
    bulkApproveMessage({ approved: 0, live: 0, failed: [{ taskId: "t9", message: "کارِ عکاسی یافت نشد." }] }),
    "هیچ‌کدام تأیید نشد — کارِ عکاسی یافت نشد.",
  );
  assert.match(bulkApproveMessage({ approved: 0, live: 0, failed: [] }), /هیچ‌کدام تأیید نشد/);
});
