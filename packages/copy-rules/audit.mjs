/**
 * رانر ممیزی مشترک — همان قاعده‌های تستِ نگهبان، برای نمایش داخل پنل.
 *
 * تست (`lib/copy.test.mjs` هر اپ) مرج را می‌بندد؛ این ماژول گزارشِ همان
 * قاعده‌ها را به شکل ساختاریافته (JSON) می‌دهد تا صفحهٔ ممیزی لحن در ادمین
 * نقض‌ها و روند را نشان دهد. هیچ قاعده‌ای اینجا دوباره تعریف نمی‌شود —
 * همه‌چیز از `core.mjs` می‌آید تا «منبع حقیقت واحد» شکسته نشود.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { checkCopy, extractCopy, hasStringLiteral, RULE_DETAIL, RULE_TITLE } from "./core.mjs";

/** دایرکتوری‌هایی که متن کاربر در آنها نیست (تولیدشده یا ابزار). */
export const SKIP_DIRS = new Set([
  "node_modules", ".next", "dist", ".turbo", "og-fonts", "scripts",
]);

/** پسوندهای منبعِ متن‌دار — همان بازهٔ تست‌های نگهبان. */
export const SOURCE_RE = /\.(tsx?|jsx?|mjs)$/;

/** @typedef {{rule: import("./core.mjs").RuleId, app: string, file: string, line: number, text: string, title: string, detail: string}} AuditViolation */

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SOURCE_RE.test(name)) out.push(full);
  }
  return out;
}

/**
 * ممیزی یک اپ — فایل‌ها را می‌خواند و نقض‌های قواعد R1–R7 را برمی‌گرداند.
 *
 * @param {{app: string, root: string, formalFiles: string[], sharedStrings: string[]}} cfg
 * @returns {{violations: AuditViolation[], summary: {app: string, files: number, pieces: number, violations: number, byRule: Record<string, number>}}}
 */
export function auditApp(cfg) {
  const root = resolve(cfg.root);
  const files = walk(root)
    .map((file) => ({ rel: relative(root, file).replace(/\\/g, "/"), src: readFileSync(file, "utf8") }))
    .filter((f) => !/\.test\./.test(f.rel))
    .sort((a, b) => a.rel.localeCompare(b.rel));

  /** @type {AuditViolation[]} */
  const violations = [];
  let pieces = 0;
  const byRule = {};
  const sourcesMap = new Map(files.map((f) => [f.rel, f.src]));

  for (const { rel, src } of files) {
    if (rel === "lib/copy-rules.mjs") continue; // تعریف مرز است، نه متن کاربر
    const formal = cfg.formalFiles.includes(rel);
    for (const piece of extractCopy(src, rel)) {
      pieces++;
      for (const rule of checkCopy(piece.text, { formal })) {
        violations.push({
          rule,
          app: cfg.app,
          file: rel,
          line: piece.line,
          text: piece.text,
          title: RULE_TITLE[rule],
          detail: RULE_DETAIL[rule],
        });
        byRule[rule] = (byRule[rule] ?? 0) + 1;
      }
    }
  }

  // R6 — متن مشترک باید تک‌منبعی باشد (تعریف‌ها در copy-rules.mjs هر اپ)
  for (const needle of cfg.sharedStrings) {
    const holders = [...sourcesMap.keys()]
      .filter((rel) => rel !== "lib/copy-rules.mjs" && hasStringLiteral(sourcesMap.get(rel), needle));
    if (holders.length > 1) {
      const rule = "R6";
      violations.push({
        rule,
        app: cfg.app,
        file: holders.join("، "),
        line: 0,
        text: needle,
        title: RULE_TITLE[rule],
        detail: RULE_DETAIL[rule],
      });
      byRule[rule] = (byRule[rule] ?? 0) + 1;
    }
  }

  violations.sort((a, b) => a.app.localeCompare(b.app) || a.file.localeCompare(b.file) || a.line - b.line);
  return {
    violations,
    summary: {
      app: cfg.app,
      files: files.length,
      pieces,
      violations: violations.length,
      byRule,
    },
  };
}
