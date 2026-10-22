#!/usr/bin/env node
/**
 * ابزار تشخیص و تعمیر «mojibake» — فارسیِ دوبار-انکدشده.
 *
 * چرا این مسئله مهم است؟  یک بار متن فارسی به‌اشتباه با CP1256 خوانده و
 * دوباره به‌صورت UTF-8 ذخیره شده. نتیجه: «ط³ط±ظˆغŒ» به‌جای «صفحهٔ».
 * این متن در فایل‌های سورس گیر کرده و مستقیم به کاربر نمایش داده می‌شود.
 *
 * ── منطق تشخیص ────────────────────────────────────────────────
 * ۱) هر حرف فارسی در UTF-8 دو بایت است. اگر متن فارسی از یک کدپیج
 *    تک‌بایتی (CP1256) رد شده باشد، هر حرف به **دو** کاراکتر تبدیل می‌شود
 *    و بایت‌های اصلی‌اش (که در UTF-8 معتبرند) پشت سر هم می‌نشینند.
 * ۲) پس «بُرشِ خراب» = دنباله‌ای از کاراکترهای CP1256 که **کلِ آن**
 *    به‌صورت UTF-8 معتبر خوانده می‌شود.
 * ۳) متن فارسیِ سالم برعکس است: حروفش تک‌بایتی‌اند و بُرششان به‌صورت
 *    UTF-8 معتبر درنمی‌آید (چون بایتِ اولِ هر حرف، بایتِ ادامه نیست).
 *    ← همین تفاوت، تفکیک‌کنندهٔ قطعی است.
 * ۴) علاوه بر آن، خروجیِ تعمیر باید «فارسیِ معقول» باشد: دست‌کم یکی از
 *    حروف/نشانه‌های رایج فارسی را داشته باشد. این کار جلوی تبدیلِ
 *    متن‌های لاتین یا عربی را می‌گیرد.
 *
 * استفاده:
 *   node infrastructure/mojibake.mjs scan [root]         ← گزارش
 *   node infrastructure/mojibake.mjs fix [--dry-run] <f…>  ← تعمیر
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { pathToFileURL } from "node:url";

/* ───────────────────────── نگاشت CP1256 ───────────────────────── */

const cp1256 = new TextDecoder("windows-1256");
const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

/** کاراکتر → بایت (فقط بازهٔ ۱۲۸..۲۵۵؛ ASCII خودش سالم است) */
const CHAR_TO_BYTE = new Map();
for (let b = 0x80; b < 256; b++) {
  const ch = cp1256.decode(new Uint8Array([b]));
  if (ch === "�") continue; // بایت تعریف‌نشده
  if (!CHAR_TO_BYTE.has(ch)) CHAR_TO_BYTE.set(ch, b);
}

const isCp1256Char = (ch) => CHAR_TO_BYTE.has(ch);

/* ───────────────────── آیا خروجی «فارسیِ معقول» است؟ ───────────────────── */

/**
 * حروف رایج فارسی (۳۲ حرف الفبا).
 * ← نکته: باید code point باشد، نه خودِ کاراکتر
 */
const PERSIAN_LETTERS = new Set(
  [...`ابپتثجحچخدذرزژسشصضطظعغفقکگلمنوهی`].map((c) => c.codePointAt(0)),
);

/** نشانه‌های تایپوگرافیک که در متن فارسی می‌آیند (و در CP1256 هم می‌شکنند) */
const TYPOGRAPHIC = new Set([
  0x00ab, 0x00bb, // « »
  0x2013, 0x2014, // – —
  0x2018, 0x2019, 0x201c, 0x201d, // ‘ ’ “ ”
  0x2022, 0x2026, 0x2030, 0x00d7, // • … ‰ ×
  0x2190, 0x2191, 0x2192, 0x2193, // ← ↑ → ↓
  0x2500, 0x2550, 0x256c, 0x2570, 0x2574, 0x2578, // خطوط کادری
]);

/** ارقام فارسی */
const PERSIAN_DIGITS = new Set(
  [..."۰۱۲۳۴۵۶۷۸۹"].map((c) => c.codePointAt(0)),
);

/**
 * کاراکترهایی که در متن فارسیِ سالم می‌آیند ولی بایتشان در بازهٔ
 * «ادامهٔ UTF-8» است (یعنی می‌توانند بایت دوم یک توالی معتبر باشند):
 * پ، ک، نیم‌فاصله، «، ؛، ».
 *
 * ترکیبِ یک حرفِ عادی با یکی از این‌ها، به‌طور تصادفی یک توالی UTF-8
 * معتبر می‌سازد. مثلاً «عک» → «ژ». پس کاراکترهایی که فقط از این راه
 * به‌دست می‌آیند، «اتفاقی» تلقی می‌شوند و تعمیرِ تک‌کاراکتری روی آن‌ها
 * انجام نمی‌شود.
 */
const LEGIT_CONTINUATION_BYTES = [0x81, 0x98, 0x9d, 0xab, 0xba, 0xbb];

/** مجموعهٔ کاراکترهایی که فقط از یک تصادف ساخته می‌شوند */
const COINCIDENCE = new Set();
for (let lead = 0xc1; lead <= 0xef; lead++) {
  for (const cont of LEGIT_CONTINUATION_BYTES) {
    COINCIDENCE.add(((lead & 0x1f) << 6) | (cont & 0x3f));
  }
}

/**
 * آیا متنِ بازیابی‌شده «فارسیِ معقول» است؟
 *
 * معیار: بیش از نیمی از کاراکترها باید حرف فارسی باشند (و دست‌کم دو حرف).
 * این معیار جلوی تبدیلِ متن‌های سالم را می‌گیرد: در متن سالم، گاهی دو
 * کاراکترِ مجاور تصادفاً یک توالی UTF-8 معتبر می‌سازند (مثل «عک» که
 * «ژ» می‌شود) — اما آن «ژ» حرف فارسیِ واقعی در آن بافت نیست.
 */
function isPlausiblePersian(text) {
  const chars = [...text];
  if (!chars.length) return false;
  const cps = chars.map((c) => c.codePointAt(0));

  if (cps.length === 1) {
    const cp = cps[0];
    if (COINCIDENCE.has(cp)) return false; // فقط از یک تصادف ساخته شده
    return (
      PERSIAN_LETTERS.has(cp) ||
      PERSIAN_DIGITS.has(cp) ||
      TYPOGRAPHIC.has(cp)
    );
  }

  let letters = 0;
  let digits = 0;
  let typo = 0;
  for (const cp of cps) {
    if (PERSIAN_LETTERS.has(cp)) letters++;
    else if (PERSIAN_DIGITS.has(cp)) digits++;
    else if (TYPOGRAPHIC.has(cp)) typo++;
  }
  const total = cps.length;
  // متنِ فارسی: دست‌کم دو حرف و دست‌کم ۶۰٪ حرف
  if (letters >= 2 && letters * 5 >= total * 3) return true;
  // عددِ تنها یا عدد و نشانه (مثل «۱» یا «۱۲»)
  if (letters === 0 && digits >= 1 && digits * 5 >= total * 3) return true;
  // فقط نشانه‌گذاری تایپوگرافیک (مثل «—» یا «→»)
  if (typo === total) return true;
  return false;
}

/* ───────────────────────── تعمیر متن ───────────────────────── */

/**
 * یک رشته را تعمیر می‌کند.
 * @returns {{ text: string, repaired: number, runs: number }}
 */
export function repairText(text) {
  const chars = [...text];
  const out = [];
  let repaired = 0;
  let runs = 0;

  let buf = [];
  const flush = () => {
    if (!buf.length) return;
    const bytes = Uint8Array.from(buf.map((c) => CHAR_TO_BYTE.get(c)));
    let decoded = null;
    try {
      decoded = strictUtf8.decode(bytes);
    } catch {
      decoded = null;
    }
    if (decoded !== null && isPlausiblePersian(decoded)) {
      out.push(decoded);
      repaired += decoded.length;
      runs++;
    } else {
      out.push(...buf);
    }
    buf = [];
  };

  for (const ch of chars) {
    if (isCp1256Char(ch)) {
      buf.push(ch);
    } else {
      flush();
      out.push(ch);
    }
  }
  flush();

  return { text: out.join(""), repaired, runs };
}

/** فقط تشخیص: چند کاراکتر قابل تعمیر در این متن هست؟ */
export function countRepairs(text) {
  return repairText(text).repaired;
}

/* ───────────────────────── خط فرمان ───────────────────────── */

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build", ".turbo", "coverage",
  ".pnpm-store", "out", ".vercel", "logs",
]);
const EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".md", ".json", ".prisma",
  ".sql", ".yml", ".yaml", ".css", ".html", ".txt",
]);

function walk(root, acc = []) {
  let entries;
  try {
    entries = readdirSync(root);
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const p = join(root, entry);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, acc);
    else if (EXTS.has(extname(entry))) acc.push(p);
  }
  return acc;
}

function cmdScan(root) {
  const hits = [];
  for (const file of walk(root)) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const n = countRepairs(text);
    if (n > 0) hits.push({ file: relative(root, file), n });
  }
  hits.sort((a, b) => b.n - a.n);
  for (const h of hits) {
    console.log(`${String(h.n).padStart(5)}  ${h.file}`);
  }
  const total = hits.reduce((s, h) => s + h.n, 0);
  console.log(`\n${hits.length} file(s) affected, ${total} character(s) repairable`);
  return hits.length > 0 ? 1 : 0;
}

function cmdFix(files, dryRun) {
  let changed = 0;
  for (const file of files) {
    const before = readFileSync(file, "utf8");
    const res = repairText(before);
    if (res.repaired === 0) {
      console.log(`· ${file} — سالم است`);
      continue;
    }
    changed++;
    console.log(`✓ ${file} — ${res.repaired} کاراکتر تعمیر شد (${res.runs} بُرش)`);
    if (!dryRun) writeFileSync(file, res.text, "utf8");
  }
  console.log(`\n${changed} file(s) ${dryRun ? "would change" : "changed"}`);
  return changed > 0 ? 1 : 0;
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
const [, , cmd, ...rest] = isMain ? process.argv : [];
if (!isMain) {
  // وقتی به‌صورت کتابخانه import می‌شود، فقط توابع صادر می‌شوند.
} else if (cmd === "scan") {
  process.exit(cmdScan(rest[0] ?? "."));
} else if (cmd === "fix") {
  const dry = rest.includes("--dry-run");
  const files = rest.filter((a) => a !== "--dry-run");
  if (!files.length) {
    console.error("file(s) required");
    process.exit(2);
  }
  process.exit(cmdFix(files, dry));
} else {
  console.log("usage: mojibake.mjs scan [root] | fix [--dry-run] <file...>");
  process.exit(2);
}
