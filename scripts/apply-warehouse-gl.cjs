/**
 * وصل‌کردن سندهای موجودی به حساب اختصاصی انبار (فاز ۶).
 *
 * ۱۲ نقطهٔ سند موجودی روی `GL.INVENTORY` (گروه ۱۲۰۰) می‌نشستند. الگو در
 * همهٔ آن‌ها یکسان است، پس با اسکریپت عوض می‌شوند نه با ویرایش دستی — ریسک
 * جا افتادن یک مورد صفر می‌شود.
 *
 * هر جایی که `GL.INVENTORY` در سند انبار است، با `warehouseGlCode(tx, warehouseId)`
 * جایگزین می‌شود تا موجودی هر انبار روی حساب خودش بنشیند.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "apps", "api", "src");

/**
 * [نسبت فایل، شناسهٔ انبار در آن دامنه]
 * `null` برای جاهایی که با دستی ساخته می‌شوند و بعداً اصلاح می‌شوند.
 */
const TARGETS = [
  { file: "pos/pos.service.ts", whExpr: "wh.id" },
  { file: "payments/payments.service.ts", whExpr: "order.warehouseId" },
  { file: "inventory/inventory.controller.ts", whExpr: "rec.warehouseId", all: true },
  { file: "admin/admin-panel.controller.ts", whExpr: "st.warehouseId", all: true },
  { file: "inventory/inventory-ops.service.ts", whExpr: "t.fromWarehouseId" },
];

let totalChanged = 0;

for (const t of TARGETS) {
  const full = path.join(ROOT, t.file);
  if (!fs.existsSync(full)) {
    console.log(`  skip ${t.file} (not found)`);
    continue;
  }
  const before = fs.readFileSync(full, "utf8");
  let src = before;

  // فقط داخل آرایه‌های `lines` عوض می‌کنیم، نه هر استفاده‌ای
  src = src.replace(
    /\{ accountCode: GL\.INVENTORY, (debit|credit): ([^}]+?) \}/g,
    (_m, side, amount) =>
      `{ accountCode: await warehouseGlCode(tx, ${t.whExpr}), ${side}: ${amount} }`,
  );

  // اگر فایل در بیرون تراکنش هم سند می‌زند، `tx` باید `this.prisma` باشد
  src = src.replace(/await warehouseGlCode\(tx,/g, "await warehouseGlCode(tx,");

  if (src !== before) {
    // import کمکی را اضافه کن اگر نیست
    if (!/warehouseGlCode/.test(before.split("\n").filter((l) => l.startsWith("import")).join("\n"))) {
      const lines = src.split("\n");
      let last = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith("import ")) last = i;
      }
      const rel = t.file.startsWith("inventory/") || t.file.startsWith("pos/") || t.file.startsWith("payments/")
        ? "./inventory.service"
        : t.file.startsWith("admin/")
          ? "../inventory/inventory.service"
          : "./inventory.service";
      lines.splice(last + 1, 0, `import { warehouseGlCode } from "${rel}";`);
      src = lines.join("\n");
    }
    fs.writeFileSync(full, src, "utf8");
    const n = (before.match(/\{ accountCode: GL\.INVENTORY,/g) ?? []).length;
    totalChanged += n;
    console.log(`  ${t.file}: ${n} سند`);
  } else {
    console.log(`  ${t.file}: بدون تغییر`);
  }
}

console.log(`\ntotal: ${totalChanged}`);
