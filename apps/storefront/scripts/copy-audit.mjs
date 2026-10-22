/**
 * ممیزی لحن و کپی فروشگاه — گزارش انسانی، همان قاعده‌های تستِ نگهبان.
 *
 * اجرا:  node apps/storefront/scripts/copy-audit.mjs [مسیر-خروجی-TSV]
 *        (یا pnpm --filter @ghasedak/storefront copy:audit)
 *
 * خروجی: هر نقض با کد قاعده و مسیر فایل:خط روی stdout (کد خروج ۱ = نقض هست)،
 * و فهرست کامل متن‌های کاربرپسند در فایل TSV برای مرور دستی.
 *
 * این ابزار «تست» نیست: تست در `lib/copy.test.mjs` است و CI را متوقف می‌کند.
 * اینجا دیدِ انسانی می‌دهیم — چه نوشته شده و کجا از مرز لحن بیرون زده.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkCopy,
  extractCopy,
  hasStringLiteral,
  isFormalFile,
  RULE_DETAIL,
  SHARED_STRINGS,
} from "../lib/copy-rules.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, ".."); // ریشهٔ اپ فروشگاه
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", ".turbo", "og-fonts", "scripts"]);
const SOURCE = /\.(tsx?|jsx?)$/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SOURCE.test(name)) out.push(full);
  }
  return out;
}

const files = walk(ROOT).sort();
const rows = [];
const sources = new Map(); // relPath → src (برای قاعدهٔ R6)
let pieces = 0;
let violations = 0;

for (const file of files) {
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  const src = readFileSync(file, "utf8");
  if (!/\.test\./.test(rel)) sources.set(rel, src);
  if (/\.test\./.test(rel)) continue;

  const formal = isFormalFile(rel);
  for (const piece of extractCopy(src, rel)) {
    pieces++;
    rows.push(`${rel}:${piece.line}\t${piece.text}`);
    const rules = checkCopy(piece.text, { formal });
    if (!rules.length) continue;
    violations++;
    for (const rule of rules) {
      console.log(`${rule}  ${rel}:${piece.line}  ${RULE_DETAIL[rule]}\n     «${piece.text}»`);
    }
  }
}

// R6 — متن مشترک نباید در چند فایل تکرار شود (باید از lib/copy.ts بیاید)
let r6 = 0;
for (const needle of SHARED_STRINGS) {
  const holders = [...sources.entries()]
    .filter(([rel, src]) => rel !== "lib/copy-rules.mjs" && hasStringLiteral(src, needle))
    .map(([rel]) => rel);
  if (holders.length > 1) {
    r6 += holders.length;
    console.log(`R6  ${holders.join(", ")}  ${RULE_DETAIL.R6}\n     «${needle}»`);
  }
}

const inventoryPath = process.argv[2] ?? join(ROOT, ".copy-inventory.tsv");
writeFileSync(inventoryPath, rows.join("\n") + "\n", "utf8");
console.log(
  `\n${pieces} قطعهٔ متن کاربرپسند در ${files.length} فایل — ${violations + r6} نقض لحن` +
    `\nمرز رسمی (۲۰٪): صفحات حقوقی/تعهدی · بقیه صمیمی (۸۰٪)` +
    `\nفهرست کامل: ${inventoryPath}`,
);
process.exit(violations + r6 ? 1 : 0);
