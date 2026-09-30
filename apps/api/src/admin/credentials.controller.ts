import { BadRequestException, Body, Controller, Get, Post } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";

/**
 * فاز پس از ۱۲ — جایگاه ورود credential ادمین (بند ۴۵/۱۱۱)
 * ============================================================
 * credential محرمانه هرگز در DB ذخیره نمی‌شود و هرگز در پاسخ API برنمی‌گردد:
 *  - POST /admin/capabilities/credentials → نوشتن/به‌روزرسانی کلیدها در apps/api/.env.local
 *    (خارج از git؛ فقط فرایند API هنگام بوت می‌خواند — لودر در main.ts)
 *  - GET  /admin/capabilities/credentials → فقط وضعیت ماسک‌شده («abc…wxyz» یا خالی)
 *
 * کلیدهای قابل نگهداری: KAVENEGAR_API_KEY، KAVENEGAR_SENDER، KAVENEGAR_OTP_TEMPLATE،
 * SMTP_HOST، SMTP_PORT، SMTP_USER، SMTP_PASS، SMTP_FROM، ZARINPAL_MERCHANT_ID
 */
const ALLOWED_KEYS = [
  "KAVENEGAR_API_KEY", "KAVENEGAR_SENDER", "KAVENEGAR_OTP_TEMPLATE",
  "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM",
  "ZARINPAL_MERCHANT_ID",
] as const;
type CredKey = (typeof ALLOWED_KEYS)[number];

const ENV_LOCAL = path.resolve(__dirname, "../../.env.local");

function readEnvLocal(): Record<string, string> {
  if (!fs.existsSync(ENV_LOCAL)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(ENV_LOCAL, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function mask(v: string | undefined): string | null {
  if (!v) return null;
  const s = String(v);
  if (s.length <= 8) return "••••";
  return `${s.slice(0, 3)}…${s.slice(-4)}`;
}

function currentValue(key: CredKey): string | undefined {
  return process.env[key] || readEnvLocal()[key] || undefined;
}

@Controller("admin/capabilities/credentials")
export class CredentialsController {
  /** فقط وضعیت ماسک‌شده — مقدار واقعی هرگز برنمی‌گردد */
  @Get()
  status() {
    const items: Record<string, { configured: boolean; masked: string | null; source: string }> = {};
    for (const k of ALLOWED_KEYS) {
      const fromEnv = Boolean(process.env[k]);
      const v = currentValue(k);
      items[k] = {
        configured: Boolean(v),
        masked: mask(v),
        source: fromEnv ? "env" : v ? "env.local" : "none",
      };
    }
    return { items, envLocalPath: "apps/api/.env.local (خارج از git)" };
  }

  /** نوشتن/به‌روزرسانی کلیدها — مقدار قبلی با کلید خالی "" پاک می‌شود */
  @Post()
  save(@Body() body: Record<string, string>) {
    const updates: Array<[CredKey, string]> = [];
    for (const [k, v] of Object.entries(body ?? {})) {
      if (!(ALLOWED_KEYS as readonly string[]).includes(k)) {
        throw new BadRequestException({ code: "UNKNOWN_KEY", message: `کلید مجاز نیست: ${k}` });
      }
      if (typeof v !== "string") {
        throw new BadRequestException({ code: "VALIDATION_ERROR", message: "مقدار باید string باشد." });
      }
      updates.push([k as CredKey, v.trim()]);
    }
    if (updates.length === 0) {
      throw new BadRequestException({ code: "EMPTY", message: "هیچ کلیدی ارسال نشده است." });
    }
    fs.mkdirSync(path.dirname(ENV_LOCAL), { recursive: true });
    const lines = fs.existsSync(ENV_LOCAL) ? fs.readFileSync(ENV_LOCAL, "utf8").split(/\r?\n/) : [];
    const written: string[] = [];
    for (const [k, v] of updates) {
      const idx = lines.findIndex((l) => /^([A-Z0-9_]+)=/.exec(l.trim())?.[1] === k);
      if (v === "") {
        if (idx > -1) lines.splice(idx, 1); // پاک‌سازی
      } else if (idx > -1) {
        lines[idx] = `${k}=${v}`;
      } else {
        lines.push(`${k}=${v}`);
      }
      written.push(k);
    }
    fs.writeFileSync(ENV_LOCAL, lines.filter((l, i, a) => l !== "" || i === a.length - 1).join("\n").trimEnd() + "\n", { encoding: "utf8", mode: 0o600 });
    // اعمال فوری روی فرایند جاری (بدون ری‌استارت هم کار می‌کند؛ توصیه: ری‌استارت)
    for (const [k, v] of updates) {
      if (v === "") delete process.env[k];
      else process.env[k] = v;
    }
    return { ok: true, written, note: "برای اطمینان، API را ری‌استارت کنید." };
  }
}
