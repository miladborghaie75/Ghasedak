/**
 * تستِ مدلِ ویرایشگرِ بخش‌های صفحهٔ محتوایی.
 *
 * اجرا:  pnpm --filter @ghasedak/admin test
 *
 * چرا مهم است: این فرم تنها راهِ ویرایشِ متنِ حقوقی از پنل است. اگر تبدیل
 * «متنِ نشانه‌گذاری‌شده ← خطوطِ فرم ← متنِ نشانه‌گذاری‌شده» چیزی را گم کند،
 * مدیر با یک ذخیره می‌تواند پیوندِ تماس یا برجسته‌کردنِ قیمت را بی‌آنکه ببیند
 * پاک کند. پس ادعای اصلی این است: **رفت‌وبرگشتِ بی‌کم‌و‌اضافه روی هر شش صفحهٔ
 * واقعی** — و نشانه‌گذاری‌های پیوند/برجسته هم جزوِ متن‌اند.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { SITE_CONTENT_PAGES, parseBody, sectionToBody } from "@ghasedak/contracts";
import {
  bodyFromLines,
  editBodyLine,
  editLineText,
  linesFromBody,
  markEffective,
  markFound,
  sectionsFromValue,
  valueFromSections,
  type SectionLine,
} from "./content-sections.ts";

test("رفت‌وبرگشتِ متنِ هر شش صفحهٔ محتوایی بی‌کم‌و‌اضافه است", () => {
  let bodies = 0;
  for (const [slug, page] of Object.entries(SITE_CONTENT_PAGES)) {
    for (const section of page.sections) {
      const body = sectionToBody(section);
      assert.equal(
        bodyFromLines(linesFromBody(body)),
        body,
        `${slug} / ${section.title ?? "(بدون تیتر)"} در رفت‌وبرگشت عوض شد`,
      );
      bodies += 1;
    }
  }
  // اگر روزی بخش‌ها از این کمتر شد، یعنی تست عملاً چیزی نمی‌سنجد
  assert.ok(bodies >= 20, `فقط ${bodies} بخش سنجیده شد — انتظار: دست‌کم ۲۰`);
});

test("نوعِ هر خط از نشانه‌گذاری خوانده می‌شود", () => {
  const lines = linesFromBody("یک بند\n- عضو اول\n- عضو دوم\n> یک یادداشت");
  assert.deepEqual(
    lines.map((l) => l.kind),
    ["p", "li", "li", "note"],
  );
  assert.deepEqual(
    lines.map((l) => l.text),
    ["یک بند", "عضو اول", "عضو دوم", "یک یادداشت"],
  );
  // خطِ خالی (جداکنندهٔ خوانا) در فرم جایی ندارد و در سایت هم دیده نمی‌شود
  assert.equal(linesFromBody("\n\n").length, 0);
});

test("پیوند و برجسته در فرم نشانه می‌شوند، نه نشانه‌گذاریِ متنی", () => {
  const body = "شمارهٔ تماس: [۰۹۱۲۳۴۵۶۷۸۹](tel:+989123456789) — هر روز ۹ تا ۲۱";
  const [line] = linesFromBody(body);
  assert.equal(line.text, "شمارهٔ تماس: ۰۹۱۲۳۴۵۶۷۸۹ — هر روز ۹ تا ۲۱");
  assert.deepEqual(line.marks, [{ text: "۰۹۱۲۳۴۵۶۷۸۹", at: 13, href: "tel:+989123456789" }]);
  assert.equal(markFound(line, line.marks[0]), true);
  assert.equal(bodyFromLines([line]), body);
});

test("برجسته و پیوند روی یک عبارت هم‌زمان می‌مانند", () => {
  const body = "نام شعبه: [**شعبهٔ مرکزی**](/contact)";
  const [line] = linesFromBody(body);
  assert.deepEqual(line.marks, [{ text: "شعبهٔ مرکزی", at: 10, href: "/contact", strong: true }]);
  assert.equal(bodyFromLines([line]), body);
});

test("پیوند روی نسخهٔ دومِ یک عبارتِ تکراری می‌ماند (نه روی اولی)", () => {
  // همان الگوی واقعیِ صفحهٔ تماس: عبارت دو بار در جمله آمده، فقط دومی پیوند است
  const body = "- برای پیگیری سفارش، کد را از صفحه [پیگیری سفارش](/order) بردار.";
  const [line] = linesFromBody(body);
  assert.equal(line.text, "برای پیگیری سفارش، کد را از صفحه پیگیری سفارش بردار.");
  assert.equal(line.marks[0].at, line.text.lastIndexOf("پیگیری سفارش"));
  assert.equal(bodyFromLines([line]), body);
});

test("ویرایشِ متن، پیوند را همراهِ جمله جابه‌جا می‌کند", () => {
  const [line] = linesFromBody("شماره: [۰۹۱۲](tel:+98912) — هر روز");
  const edited = editLineText(line, "شمارهٔ تماس: ۰۹۱۲ — هر روز");
  assert.equal(edited.text, "شمارهٔ تماس: ۰۹۱۲ — هر روز");
  assert.equal(markFound(edited, edited.marks[0]), true);
  // همان پیوند، سرِ همان شماره — نه روی نویسه‌های جابه‌جاشده
  assert.equal(bodyFromLines([edited]), "شمارهٔ تماس: [۰۹۱۲](tel:+98912) — هر روز");
});

test("ویرایشِ داخلِ عبارتِ پیوند، پیوند را بیش از حد نمی‌کشد", () => {
  const [line] = linesFromBody("تماس: [۰۹۱۲](tel:+98912)");
  const edited = editLineText(line, "تماس: ۰۹۱۲۳");
  assert.equal(bodyFromLines([edited]), "تماس: [۰۹۱۲](tel:+98912)۳");
});

test("عضوِ فهرستی که تمامش پیوند است دست‌نخورده می‌ماند", () => {
  const body = "- [پیگیری سفارش](/order)\n- بازگشت کالا";
  const lines = linesFromBody(body);
  assert.equal(lines[0].kind, "li");
  assert.equal(lines[0].text, "پیگیری سفارش");
  assert.equal(bodyFromLines(lines), body);
});

test("نشانه‌ای که عبارتِ آن در متن نیست، متن را عوض نمی‌کند", () => {
  const line: SectionLine = {
    kind: "p",
    text: "متنِ ویرایش‌شده",
    marks: [{ text: "عبارتِ حذف‌شده", href: "/x" }],
  };
  assert.equal(bodyFromLines([line]), "متنِ ویرایش‌شده");
  assert.equal(markFound(line, line.marks[0]), false);
});

test("نشانه‌های اضافه‌شده به ترتیبِ خودِ متن می‌نشینند (نه ترتیبِ فهرست)", () => {
  const line: SectionLine = {
    kind: "p",
    text: "اول متن، آخرش پایان",
    // مدیر اول پیوندِ «پایان» را ساخته، بعد «اول» را
    marks: [
      { text: "پایان", href: "/end" },
      { text: "اول", strong: true },
    ],
  };
  assert.equal(bodyFromLines([line]), "**اول** متن، آخرش [پایان](/end)");
});

test("نشانهٔ هم‌پوشان دوبار اعمال نمی‌شود و متن گم نمی‌شود", () => {
  const line: SectionLine = {
    kind: "p",
    text: "قیمتِ کالا",
    marks: [
      { text: "قیمتِ کالا", href: "/a" },
      { text: "کالا", href: "/b" },
    ],
  };
  assert.equal(bodyFromLines([line]), "[قیمتِ کالا](/a)");
});

test("نشانیِ ناامن هرگز در متنِ ذخیره‌شده نمی‌نشیند", () => {
  const line: SectionLine = {
    kind: "p",
    text: "کلیک کن",
    marks: [{ text: "کلیک کن", href: "javascript:alert(1)", strong: true }],
  };
  const body = bodyFromLines([line]);
  assert.equal(body.includes("javascript:"), false);
  // برجستگی حقِ خودش است — بهانهٔ برداشتنِ پیوند نمی‌شود
  assert.equal(body, "**کلیک کن**");
});

test("نشانهٔ بی‌اثر (بدون نشانی و بدون برجسته) نادیده گرفته می‌شود", () => {
  assert.equal(markEffective({ text: "x" }), false);
  assert.equal(markEffective({ text: "x", href: "" }), false);
  assert.equal(markEffective({ text: "x", href: "/y" }), true);
  assert.equal(markEffective({ text: "x", href: "javascript:1" }), false);
  assert.equal(markEffective({ text: "x", strong: true }), true);
});

test("خطِ بی‌متن در متنِ ذخیره نمی‌نشیند ولی تیتر و ترتیبِ بقیه می‌ماند", () => {
  const rows = valueFromSections([
    { id: "s1", title: "تیتر", lines: [{ id: "l1", kind: "p", text: "", marks: [] }] },
    { id: "s2", title: "دوم", lines: [{ id: "l2", kind: "note", text: "نکته", marks: [] }] },
  ]);
  assert.deepEqual(rows, [
    { title: "تیتر", body: "" },
    { title: "دوم", body: "> نکته" },
  ]);
});

test("شمارهٔ خطِ رندر و مدلِ ویرایش یکی است (ویرایشِ درجا خطِ درست را می‌گیرد)", () => {
  let bodies = 0;
  for (const [slug, page] of Object.entries(SITE_CONTENT_PAGES)) {
    for (const section of page.sections) {
      const body = sectionToBody(section);
      assert.equal(
        parseBody(body).length,
        linesFromBody(body).length,
        `${slug} / ${section.title ?? "(بدون تیتر)"}: شمارهٔ خط‌ها یکی نیست`,
      );
      bodies += 1;
    }
  }
  assert.ok(bodies >= 20, `فقط ${bodies} بخش سنجیده شد — انتظار: دست‌کم ۲۰`);
});

test("ویرایشِ درجای یک خط فقط همان خط را عوض می‌کند و نوع/پیوند را نگه می‌دارد", () => {
  const rows = [
    { title: "الف", body: "سلام\n- [تماس](/contact)\n> نکته" },
    { title: "ب", body: "دوم" },
  ];
  const bodies = (value: unknown) =>
    (value as Array<{ title: string; body: string }>).map((row) => row.body);

  assert.deepEqual(bodies(editBodyLine(rows, 0, 1, "تماس با ما")), [
    "سلام\n- [تماس](/contact) با ما\n> نکته",
    "دوم",
  ]);
  // یادداشت یادداشت می‌ماند، فقط متنش عوض می‌شود
  assert.deepEqual(bodies(editBodyLine(rows, 0, 2, "تازه")), ["سلام\n- [تماس](/contact)\n> تازه", "دوم"]);
});

test("ویرایشِ درجا خطِ تازه‌خط‌دار را به یک خط جمع می‌کند و شمارهٔ نامعتبر را دست نمی‌زند", () => {
  const rows = [{ title: "", body: "یک" }];
  const bodies = (value: unknown) => (value as Array<{ body: string }>).map((row) => row.body);
  assert.deepEqual(bodies(editBodyLine(rows, 0, 0, "یک\nدو")), ["یک دو"]);
  assert.deepEqual(editBodyLine(rows, 3, 0, "x"), rows);
  assert.deepEqual(editBodyLine(rows, 0, 8, "x"), rows);
});

test("مقدارِ ناشناخته در پنل صفحه را نمی‌شکند", () => {
  assert.deepEqual(sectionsFromValue(undefined), []);
  assert.deepEqual(sectionsFromValue("nope"), []);
  // سطرهای بی‌شکل دور ریخته می‌شوند؛ تیترِ غیرمتنی خالی می‌شود، نه اینکه خطا بدهد
  const rows = sectionsFromValue([null, 3, { title: 5, body: [] }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "");
  assert.deepEqual(rows[0].lines, []);
});
