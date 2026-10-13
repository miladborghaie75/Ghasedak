/**
 * حذف بلوک‌های JSX تب‌های منتقل‌شده.
 *
 * روش: از `{tab === "X" ? (` شروع می‌کنیم و **با شمارش براکت** تا
 * `) : null}` متناظر می‌رویم. روش قبلی با `indexOf` اشتباه بود چون
 * اولین `) : null}` بعد از شروع بلوک را برمی‌داشت، نه انتهایش.
 */
const fs = require("fs");
const FILE = "apps/admin/app/accounting/AccountingClient.tsx";

let src = fs.readFileSync(FILE, "utf8");
const targets = ["entries", "manual", "tree", "payroll"];
let removed = 0;

for (const key of targets) {
  const marker = `{tab === "${key}" ? (`;
  const start = src.indexOf(marker);
  if (start < 0) {
    console.log(`  skip ${key}: marker not found`);
    continue;
  }

  // شمارش پرانتز/کروشه از همان‌جا شروع می‌شود تا متناظر را پیدا کنیم
  let depth = 0;
  let i = start;
  let endMarker = -1;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    // در عمق صفر، الگوی پایان JSX ternary را می‌بینیم
    if (depth === 0 && src.startsWith(") : null}", i)) {
      endMarker = i;
      break;
    }
  }
  if (endMarker < 0) {
    console.log(`  skip ${key}: end not found`);
    continue;
  }

  let cut = endMarker + ") : null}".length;
  // خط بعد اگر خالی است، آن را هم می‌بریم تا فاصلهٔ اضافه نماند
  if (src[cut] === "\r") cut++;
  if (src[cut] === "\n") cut++;
  src = src.slice(0, start) + src.slice(cut);
  removed++;
  console.log(`  removed tab "${key}" (${endMarker - start} chars)`);
}

fs.writeFileSync(FILE, src, "utf8");
console.log(`total removed: ${removed}`);