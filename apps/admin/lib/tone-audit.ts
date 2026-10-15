/**
 * ممیزی لحن سمت سرور ادمین — پل بین هستهٔ مشترک `@ghasedak/copy-rules`
 * و روت‌های `/api/tone-audit`. منبع حقیقت قاعده‌ها همان پکیج است؛ اینجا
 * فقط دو اپ (ادمین + فروشگاه) با مرزِ خودشان سنجیده می‌شوند و «انتشار»
 * یعنی جایگزینی امن متن در سورس از طریق `applyReplacement`.
 *
 * نکتهٔ استقرار: ممیزی سورسِ همین مخزن را از دیسک می‌خواند؛ اگر سورس
 * کامل نباشد خطای صریح می‌دهد — وضعیت ساختگی نشان نمی‌دهد (بند ۱۱۱).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { auditApp, type ToneAuditViolation } from "@ghasedak/copy-rules/audit";
import { applyReplacement, ReplacementError } from "@ghasedak/copy-rules/apply";
import { FORMAL_FILES as ADMIN_FORMAL, SHARED_STRINGS as ADMIN_SHARED } from "./copy-rules.mjs";
import {
  FORMAL_FILES as SHOP_FORMAL,
  SHARED_STRINGS as SHOP_SHARED,
} from "../../storefront/lib/copy-rules.mjs";

export type ToneAppId = "admin" | "storefront";

export interface ToneAppSummary {
  id: ToneAppId;
  label: string;
  files: number;
  pieces: number;
  violations: number;
  byRule: Record<string, number>;
}

export interface ToneAuditReport {
  generatedAt: string;
  apps: ToneAppSummary[];
  violations: ToneAuditViolation[];
}

/** خطای انتشار — کد برای ترجمه به HTTP در روت. */
export class TonePublishError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/** ریشهٔ اپ‌ها — cwd سرور ادمین خودِ apps/admin است. */
const ADMIN_ROOT = process.cwd();
const APPS: Array<{
  id: ToneAppId;
  label: string;
  root: string;
  formalFiles: string[];
  sharedStrings: string[];
}> = [
  {
    id: "admin",
    label: "پنل ادمین",
    root: ADMIN_ROOT,
    formalFiles: ADMIN_FORMAL,
    sharedStrings: ADMIN_SHARED,
  },
  {
    id: "storefront",
    label: "فروشگاه",
    root: resolve(ADMIN_ROOT, "../storefront"),
    formalFiles: SHOP_FORMAL,
    sharedStrings: SHOP_SHARED,
  },
];

/** ممیزی هر دو اپ — همان قاعده‌های تست نگهبان، خروجی ساختاریافته. */
export function runToneAudit(): ToneAuditReport {
  const violations: ToneAuditViolation[] = [];
  const apps: ToneAppSummary[] = [];
  for (const app of APPS) {
    const result = auditApp({
      app: app.id,
      root: app.root,
      formalFiles: app.formalFiles,
      sharedStrings: app.sharedStrings,
    });
    violations.push(...result.violations);
    apps.push({ id: app.id, label: app.label, ...result.summary });
  }
  return { generatedAt: new Date().toISOString(), apps, violations };
}

/**
 * انتشار یک اصلاح — متن را در فایل سورس جایگزین می‌کند.
 * امنیت مسیر: فایل باید داخل ریشهٔ همان اپ بماند و `..` نداشته باشد.
 * یکتایی و سلامت quote را `applyReplacement` تضمین می‌کند.
 */
export function publishToneFix(input: {
  app: string;
  file: string;
  line?: number;
  text: string;
  replacement: string;
}): { app: ToneAppId; file: string; text: string; replacement: string } {
  const app = APPS.find((a) => a.id === input.app);
  if (!app) throw new TonePublishError("APP_UNKNOWN", "اپ نامعتبر است؛ ممیزی را دوباره اجرا کن.");
  const rel = String(input.file ?? "").replace(/\\/g, "/").trim();
  if (!rel || rel.includes("..") || /[\r\n]/.test(rel) || rel.startsWith("/")) {
    throw new TonePublishError("BAD_PATH", "مسیر فایل نامعتبر است؛ ممیزی را دوباره اجرا کن.");
  }
  const target = resolve(app.root, rel);
  const back = relative(app.root, target);
  if (back.startsWith("..") || back === "" || /\r|\n/.test(back)) {
    throw new TonePublishError("BAD_PATH", "مسیر فایل از ریشهٔ اپ بیرون می‌زند.");
  }
  let src: string;
  try {
    src = readFileSync(target, "utf8");
  } catch {
    throw new TonePublishError("FILE_NOT_FOUND", "فایل پیدا نشد؛ ممیزی را دوباره اجرا کن.");
  }
  let out: string;
  try {
    out = applyReplacement(src, {
      text: input.text,
      replacement: input.replacement,
      line: input.line,
    });
  } catch (e) {
    if (e instanceof ReplacementError) throw new TonePublishError(e.code, e.message);
    throw e;
  }
  writeFileSync(target, out, "utf8");
  return { app: app.id, file: back.replace(/\\/g, "/"), text: input.text, replacement: input.replacement };
}
