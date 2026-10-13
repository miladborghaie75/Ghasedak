const fs = require("fs");
const path = require("path");
const ROOT = process.cwd();
const SKIP = new Set(["node_modules", ".next", ".git", "dist", ".turbo", ".run-local", "coverage"]);
const bad = [];
let scanned = 0;

function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP.has(e.name)) continue;
      walk(full);
      continue;
    }
    if (!/\.(ts|tsx|js|jsx|mjs|cjs|json|css|prisma|md|sql|yaml|yml|txt)$/i.test(e.name)) continue;
    let buf;
    try {
      buf = fs.readFileSync(full);
    } catch {
      continue;
    }
    scanned++;
    const rel = path.relative(ROOT, full);
    const nul = buf.includes(0);
    // بدنهٔ فایل باید UTF-8 معتبر باشد؛ اگر نبود یعنی باینری شده
    let invalidUtf8 = false;
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(buf);
    } catch {
      invalidUtf8 = true;
    }
    const bom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
    if (nul || invalidUtf8) bad.push({ rel, nul, invalidUtf8 });
    else if (bom) bad.push({ rel, nul: false, invalidUtf8: false, bom: true });
  }
}

walk(ROOT);
console.log("scanned files: " + scanned);
if (bad.length === 0) {
  console.log("CLEAN — no null bytes, no binary files");
} else {
  console.log("PROBLEMS: " + bad.length);
  for (const b of bad) {
    console.log("  " + b.rel + (b.bom ? "  [BOM]" : "") + (b.nul ? "  [NULL-BYTE]" : "") + (b.invalidUtf8 ? "  [BINARY/INVALID-UTF8]" : ""));
  }
}