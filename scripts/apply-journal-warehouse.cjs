/**
 * دادن `warehouseId` در سطح سند برای سندهای انبار (فاز ۶).
 *
 * هر سند انبار باید بگوید «این سند برای کدام انبار است» تا
 * `JournalLine.warehouseId` پر شود و گزارش سود هر انبار ممکن شود.
 * الگو در همهٔ سرویس‌ها یکسان است، پس با اسکریپت اضافه می‌شود.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "apps", "api", "src");

/** [نسبت فایل، عبارت انبار، شناسهٔ مبدأ در همان دامنه] */
const TARGETS = [
  { file: "pos/pos.service.ts", after: "sourceId: input.id,", wh: "warehouseId" },
  { file: "payments/payments.service.ts", after: "sourceId: orderId,", wh: "order.warehouseId" },
  { file: "inventory/purchasing.service.ts", after: "sourceId: rec.id,", wh: "input.warehouseId" },
  { file: "admin/admin-panel.controller.ts", after: "sourceId: st.id,", wh: "st.warehouseId" },
];

let total = 0;

for (const t of TARGETS) {
  const full = path.join(ROOT, t.file);
  if (!fs.existsSync(full)) {
    console.log(`  skip ${t.file}`);
    continue;
  }
  const before = fs.readFileSync(full, "utf8");

  // فقط جایی که بلافاصله قبلش `sourceId:` آمده — یعنی همان سند انبار
  const lines = before.split("\n");
  let n = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(t.after)) {
      // خط بعدی نباید تکراری باشد
      if (lines[i + 1]?.includes("warehouseId:")) continue;
      lines.splice(i + 1, 0, `        warehouseId: ${t.wh},`);
      n++;
      i++;
    }
  }

  if (n > 0) {
    fs.writeFileSync(full, lines.join("\n"), "utf8");
    total += n;
    console.log(`  ${t.file}: ${n} سند`);
  } else {
    console.log(`  ${t.file}: بدون تغییر`);
  }
}

console.log(`\ntotal: ${total}`);
