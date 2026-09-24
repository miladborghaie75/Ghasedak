import { Injectable, UnauthorizedException } from "@nestjs/common";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { PrismaService } from "../prisma/prisma.service";

export const SESSION_COOKIE = "ghasedak_admin_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12h

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

  /** ورود — بند ۶: هش امن + session امن؛ scrypt تولیدی Node (argon2id پس از افزودن وابستگی native) */
  async login(email: string, password: string): Promise<{ token: string; expiresAt: Date }> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user?.passwordHash || user.status !== "ACTIVE") {
      throw new UnauthorizedException({ code: "BAD_CREDENTIALS", message: "ایمیل یا رمز نادرست است." });
    }
    if (!this.verify(password, user.passwordHash)) {
      throw new UnauthorizedException({ code: "BAD_CREDENTIALS", message: "ایمیل یا رمز نادرست است." });
    }
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.prisma.adminSession.create({
      data: { userId: user.id, tokenHash: this.hashToken(token), expiresAt },
    });
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
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
    return scryptSync(token, "ghasedak-session", 32).toString("hex");
  }

  private verify(password: string, stored: string): boolean {
    const [scheme, salt, hash] = stored.split("$");
    if (scheme !== "scrypt" || !salt || !hash) return false;
    const candidate = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
    const expected = Buffer.from(hash, "hex");
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  }
}
