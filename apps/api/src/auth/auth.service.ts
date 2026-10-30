import { Injectable, UnauthorizedException } from "@nestjs/common";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import * as argon2 from "argon2";
import { PrismaService } from "../prisma/prisma.service";

export const SESSION_COOKIE = "ghasedak_admin_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12h

/**
 * پارامترهای argon2id (راهنمای OWASP 2024): حافظه ≥ ۱۹ MiB (۱۹۴۵۶ KiB)،
 * ۲ تکرار، توازن‌دهندهٔ ۱ — خروجی رشتهٔ استاندارد PHC مثل
 * `$argon2id$v=19$m=19456,p=1,t=2$<salt>$<hash>`.
 */
const ARGON2_OPTIONS: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

/**
 * تشخیص scheme هشِ ذخیره‌شده در `User.passwordHash`:
 *  - `scrypt$salt$hash` — قالب قدیمی (بدون `$` ابتدایی)
 *  - `$argon2id$...` — رشتهٔ PHC استاندارد (قالب فعلی)
 */
export function hashInfo(stored: string | null | undefined): { scheme: "scrypt" | "argon2id" } | null {
  if (!stored) return null;
  if (stored.startsWith("$argon2id$")) return { scheme: "argon2id" };
  if (stored.startsWith("scrypt$")) return { scheme: "scrypt" };
  return null;
}

/**
 * هش گذرواژه — تنها مسیر ساخت هش رمز در کل سیستم (مهاجرت گام ۲۲).
 * static است تا هر چهار سازندهٔ هش (ورود، بازیابی رمز، ساخت کاربر ادمین، seed)
 * بدون وابستگی به DI از همین یک جا استفاده کنند و فرمت متفرقه باقی نماند.
 */
export async function hashPasswordArgon2id(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

/**
 * اعتبارسنجی گذرواژه — هر دو قالب را می‌پذیرد.
 * `needsRehash` یعنی هش معتبر ولی قدیمی است (scrypt) → مسیر ورود باید فوراً با argon2id جایگزینش کند.
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<{ ok: boolean; needsRehash: boolean }> {
  const info = hashInfo(stored);
  if (!info) return { ok: false, needsRehash: false };
  if (info.scheme === "argon2id") {
    try {
      return { ok: await argon2.verify(stored, password), needsRehash: false };
    } catch {
      return { ok: false, needsRehash: false };
    }
  }
  // قالب قدیمی scrypt — دقیقاً همان پارامترهای قبلی (N=16384, r=8, p=1 و ۳۲ بایت خروجی)
  const [, salt, hash] = stored.split("$");
  if (!salt || !hash) return { ok: false, needsRehash: false };
  const candidate = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  const expected = Buffer.from(hash, "hex");
  const ok = candidate.length === expected.length && timingSafeEqual(candidate, expected);
  return { ok, needsRehash: ok };
}

export interface AdminIdentity {
  userId: string;
  name: string | null;
  email: string | null;
  role: string;
  permissions: string[];
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  /** ورود — بند ۶: هش امن + session امن؛ argon2id با rehash هنگام ورود (مهاجرت گام ۲۲) */
  async login(email: string, password: string): Promise<{ token: string; expiresAt: Date }> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user?.passwordHash || user.status !== "ACTIVE") {
      throw new UnauthorizedException({ code: "BAD_CREDENTIALS", message: "ایمیل یا رمز نادرست است." });
    }
    const check = await verifyPassword(password, user.passwordHash);
    if (!check.ok) {
      throw new UnauthorizedException({ code: "BAD_CREDENTIALS", message: "ایمیل یا رمز نادرست است." });
    }
    // مهاجرت شفاف: کاربر با هش قدیمی scrypt وارد شد → همان لحظه با argon2id جایگزین می‌شود
    // (کاربر چیزی نمی‌بیند؛ شکستِ نوشتن نباید ورود را بگیرد)
    if (check.needsRehash) {
      const upgraded = await hashPasswordArgon2id(password).catch(() => null);
      if (upgraded) {
        await this.prisma.user
          .update({ where: { id: user.id }, data: { passwordHash: upgraded } })
          .catch(() => undefined);
      }
    }
    const session = await this.startSession(user.id);
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return session;
  }

  /**
   * ساخت نشست برای هر کاربرِ فعال (ادمین یا مشتری) — تنها جایی که توکن صادر می‌شود.
   * ورود با رمز، ورود با OTP و هر مسیر ورود آینده همین را صدا می‌زنند تا
   * هش‌کردن توکن، انقضا و ردیف AdminSession در یک جا باشد.
   */
  async startSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.prisma.adminSession.create({
      data: { userId, tokenHash: this.hashToken(token), expiresAt },
    });
    return { token, expiresAt };
  }

  async logout(req: Request): Promise<void> {
    const token = this.readCookie(req);
    if (token) {
      await this.prisma.adminSession.deleteMany({ where: { tokenHash: this.hashToken(token) } });
    }
  }

  /** اعتبارسنجی session + بارگذاری permissions از RolePermission */
  async identity(req: Request): Promise<AdminIdentity | null> {
    const token = this.readCookie(req);
    if (!token) return null;
    const session = await this.prisma.adminSession.findUnique({
      where: { tokenHash: this.hashToken(token) },
      include: { user: true },
    });
    if (!session || session.expiresAt < new Date() || session.user.status !== "ACTIVE") return null;
    const perms = await this.prisma.rolePermission.findMany({
      where: { role: session.user.role },
    });
    return {
      userId: session.user.id,
      name: session.user.name,
      email: session.user.email,
      role: session.user.role,
      permissions: perms.map((p) => p.permissionKey),
    };
  }

  /** id کاربر سیستم برای هویت API-Key — اولین SUPERADMIN فعال */
  async systemUserId(): Promise<string | null> {
    const u = await this.prisma.user.findFirst({
      where: { role: "SUPER_ADMIN", status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
    });
    return u?.id ?? null;
  }

  private readCookie(req: Request): string | null {
    const cookie = req.headers.cookie;
    if (!cookie) return null;
    for (const part of cookie.split(";")) {
      const [k, ...rest] = part.trim().split("=");
      if (k === SESSION_COOKIE) return decodeURIComponent(rest.join("="));
    }
    return null;
  }

  private hashToken(token: string): string {
    // token تصادفی ۲۵۶بیتی است — هش برای امنیت DB در برابر نشت
    // (این هشِ **توکن session** است، نه هش گذرواژه — scrypt همین‌جا دست‌نخورده می‌ماند)
    return scryptSync(token, "ghasedak-session", 32).toString("hex");
  }
}
