/**
 * تستِ قواعدِ عکسِ برنامهٔ عکاسی — همان چیزی که پیش از آپلود سنجیده می‌شود.
 *
 * اجرا:  pnpm --filter @ghasedak/admin test
 *        (یا: node --experimental-strip-types --test apps/admin/lib/photo-upload.test.ts)
 *
 * چرا مهم است: اگر این قواعد با API اختلاف داشته باشند، یا فایلِ سالم رد می‌شود
 * (عکاس فکر می‌کند آپلود خراب است) یا فایلِ بزرگ راه می‌افتد و بعد از چند مگابایت
 * آپلود، سرور ردش می‌کند.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_PHOTO_BYTES,
  PHOTO_IMAGE_TYPES,
  checkPhotoFile,
  firstPhotoFile,
  isPhotoDrag,
} from "./photo-upload.ts";

const file = (type: string, size: number) => ({ type, size });

test("سه فرمتِ سایت پذیرفته می‌شوند و چیزِ دیگری نه", () => {
  for (const type of PHOTO_IMAGE_TYPES) {
    assert.equal(checkPhotoFile(file(type, 2048)), null, type);
  }
  for (const type of ["image/gif", "image/svg+xml", "application/pdf", "text/plain", ""]) {
    assert.equal(checkPhotoFile(file(type, 2048))?.code, "type", type);
  }
});

test("فایلِ خالی و عکسِ انتخاب‌نشده، پیامِ روشن می‌دهند", () => {
  assert.equal(checkPhotoFile(null)?.code, "empty");
  assert.equal(checkPhotoFile(file("image/jpeg", 0))?.code, "empty");
});

test("سقفِ حجم دقیقاً ۱۰ مگابایت است — مرز پذیرفته، یک بایت بیشتر رد", () => {
  assert.equal(checkPhotoFile(file("image/png", MAX_PHOTO_BYTES)), null);
  const over = checkPhotoFile(file("image/png", MAX_PHOTO_BYTES + 1));
  assert.equal(over?.code, "size");
  assert.match(over!.message, /۱۰/);
});

test("کشیدنِ متن هایلایتِ «رها کن» را روشن نمی‌کند", () => {
  assert.equal(isPhotoDrag(["text/plain"]), false);
  assert.equal(isPhotoDrag([]), false);
  assert.equal(isPhotoDrag(undefined), false);
  assert.equal(isPhotoDrag(["Files"]), true);
  // بعضی مرورگرها types را خالی می‌دهند ولی files پر است
  assert.equal(isPhotoDrag([], true), true);
});

test("از میان چند فایل، اولی عکسِ مجاز می‌نشیند", () => {
  assert.equal(firstPhotoFile([file("application/pdf", 10), file("image/webp", 10)])?.type, "image/webp");
  assert.equal(firstPhotoFile([file("image/jpeg", 10)])?.type, "image/jpeg");
  assert.equal(firstPhotoFile([file("application/pdf", 10)]), null);
  assert.equal(firstPhotoFile(null), null);
});
