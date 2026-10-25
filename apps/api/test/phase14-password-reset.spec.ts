/**
 * بند ۳ — بازیابی رمز: چرخهٔ کامل واقعی روی rehearsal
 *  - forgot ادمین: توکن + ردیف هش‌شده + ردیف Notification (صف ایمیل)
 *  - enumeration-safe: حساب ناموجود هم همان پاسخ، بدون ردیف
 *  - reset: رمز عوض می‌شود، ورود با رمز جدید ممکن، توکن یک‌بارمصرف، sessionها کشته می‌شوند
 *  - انقضا: توکن منقضی رد می‌شود؛ purgeExpired پاک می‌کند
 *  - مشتری: با موبایل؛ مشتریِ بدون رمز هیچ توکنی نمی‌گیرد (پاسخ یکسان)
 *  - rate limit: تلاش چهارم forgot در پنجره RATE_LIMITED
 */
import "reflect-metadata";
import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "../src/prisma/prisma.service";
import { PasswordResetService, RESET_TTL_MS } from "../src/auth/password-reset.service";
import { PasswordResetController } from "../src/auth/password-reset.controller";
import { AuthService } from "../src/auth/auth.service";

jest.setTimeout(120_000);

describe("Phase 14 item3 — password reset", () => {
  let prisma: PrismaService;
  let svc: PasswordResetService;
  let ctl: PasswordResetController;
  let auth: AuthService;
  const tag = `pr${Date.now()}${Math.floor(Math.random() * 100000)}`;
  let adminEmail: string;
  let adminPassword: string;
  let userId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    svc = new PasswordResetService(prisma);
    ctl = new PasswordResetController(svc);
    auth = new AuthService(prisma);
    adminEmail = `reset-admin-${tag}@ghasedak.test`;
    adminPassword = `Old#Pass${tag}`;
    const u = await prisma.user.create({
      data: { email: adminEmail, passwordHash: await PasswordResetService.hashPassword(adminPassword), name: "Reset Admin (TEST)", role: "SUPER_ADMIN", status: "ACTIVE" },
    });
    userId = u.id;
  });

  afterAll(async () => {
    await prisma.passwordResetToken.deleteMany({ where: { userId } }).catch(() => undefined);
    await prisma.notification.deleteMany({ where: { to: adminEmail } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("forgot ادمین: ردیف توکن هش‌شده + صف ایمیل + devToken در غیر prod", async () => {
    const r = await ctl.forgot({ purpose: "admin", identifier: adminEmail });
    expect(r.requested).toBe(true);
    expect(r.channel).toBe("email");
    if (process.env.NODE_ENV !== "production") expect(r.devToken).toBeTruthy();
    const rows = await prisma.passwordResetToken.findMany({ where: { userId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).not.toBe(r.devToken); // فقط hash ذخیره شده (بند ۴۵)
    expect(rows[0].purpose).toBe("admin");
    const notif = await prisma.notification.findFirst({ where: { to: adminEmail, templateKey: "password-reset:admin" } });
    expect(notif).toBeTruthy();
    expect(notif!.status).toBe("QUEUED"); // بدون SMTP واقعی در صف می‌ماند — نه فیک SENT
  });

  it("enumeration-safe: ایمیل ناموجود همان پاسخ را می‌دهد و هیچ ردیفی نمی‌سازد", async () => {
    const before = await prisma.passwordResetToken.count();
    const r = await ctl.forgot({ purpose: "admin", identifier: `no-such-${tag}@ghasedak.test` });
    expect(r.requested).toBe(true);
    expect(r.devToken).toBeUndefined();
    expect(await prisma.passwordResetToken.count()).toBe(before);
  });

  it("rate limit: تلاش چهارم forgot روی همان identifier → RATE_LIMITED", async () => {
    const em = `rl-${tag}@ghasedak.test`;
    ctl.forgot({ purpose: "admin", identifier: em }).catch(() => undefined);
    ctl.forgot({ purpose: "admin", identifier: em }).catch(() => undefined);
    ctl.forgot({ purpose: "admin", identifier: em }).catch(() => undefined);
    await expect(ctl.forgot({ purpose: "admin", identifier: em })).rejects.toThrow(BadRequestException);
  });

  it("reset: رمز عوض می‌شود، ورود جدید OK، توکن یک‌بارمصرف، sessionها پاک", async () => {
    const req = await svc.request({ purpose: "admin", identifier: adminEmail });
    const token = req.devToken!;
    // session قدیمی بساز تا کشته‌شدنش اثبات شود
    await auth.login(adminEmail, adminPassword);
    const sessionsBefore = await prisma.adminSession.count({ where: { userId } });
    expect(sessionsBefore).toBeGreaterThan(0);

    const newPassword = `New#Pass${tag}`;
    await expect(svc.reset({ purpose: "admin", token: token.slice(0, -1) + (token.endsWith("a") ? "b" : "a"), newPassword })).rejects.toThrow(UnauthorizedException);
    await svc.reset({ purpose: "admin", token, newPassword });

    // ورود با رمز قدیمی ممنوع، با رمز جدید OK
    await expect(auth.login(adminEmail, adminPassword)).rejects.toThrow(UnauthorizedException);
    const login = await auth.login(adminEmail, newPassword);
    expect(login.token).toBeTruthy();

    // sessionهای قبلی کشته شدند؛ فقط session جدید هست
    const sessions = await prisma.adminSession.findMany({ where: { userId } });
    expect(sessions).toHaveLength(1);

    // توکن مصرف‌شده دیگر کار نمی‌کند
    await expect(svc.reset({ purpose: "admin", token, newPassword })).rejects.toThrow(UnauthorizedException);

    // رمز فعلی برای تست‌های بعدی به رمز اول برگردد
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: await PasswordResetService.hashPassword(adminPassword) } });
  });

  it("انقضا: توکن منقضی رد می‌شود و purgeExpired پاکش می‌کند", async () => {
    await prisma.passwordResetToken.create({
      data: { userId, tokenHash: PasswordResetService.hashToken(`exp-${tag}`), purpose: "admin", channel: "email", sentTo: adminEmail, expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(svc.reset({ purpose: "admin", token: `exp-${tag}`, newPassword: "Whatever#1" })).rejects.toThrow(UnauthorizedException);
    const purged = await svc.purgeExpired();
    expect(purged).toBeGreaterThanOrEqual(1);
    expect(await prisma.passwordResetToken.count({ where: { userId, tokenHash: PasswordResetService.hashToken(`exp-${tag}`) } })).toBe(0);
  });

  it("مشتری: موبایل با رمز → توکن sms؛ مشتری بدون رمز → پاسخ یکسان بدون ردیف", async () => {
    // مشتری با گذرواژه
    const cu = await prisma.user.create({
      data: { mobile: `0912${String(Date.now()).slice(-7)}`, passwordHash: await PasswordResetService.hashPassword("Cust#Pass1"), name: "Reset Customer (TEST)", role: "CUSTOMER", status: "ACTIVE" },
    });
    try {
      const r = await svc.request({ purpose: "customer", identifier: cu.mobile! });
      expect(r.channel).toBe("sms");
      expect(r.devToken).toBeTruthy();
      const row = await prisma.passwordResetToken.findFirst({ where: { userId: cu.id } });
      expect(row?.channel).toBe("sms");
      const notif = await prisma.notification.findFirst({ where: { to: cu.mobile!, templateKey: "password-reset:customer" } });
      expect(notif).toBeTruthy();
    } finally {
      await prisma.passwordResetToken.deleteMany({ where: { userId: cu.id } }).catch(() => undefined);
      await prisma.notification.deleteMany({ where: { to: cu.mobile! } }).catch(() => undefined);
      await prisma.user.delete({ where: { id: cu.id } }).catch(() => undefined);
    }

    // مشتری بدون گذرواژه — پاسخ یکسان، هیچ ردیفی
    const before = await prisma.passwordResetToken.count();
    const cu2Mobile = `0913${String(Date.now()).slice(-7)}`;
    await prisma.customer.create({ data: { mobile: cu2Mobile, name: "NoPass (TEST)" } });
    const r2 = await svc.request({ purpose: "customer", identifier: cu2Mobile });
    expect(r2.requested).toBe(true);
    expect(r2.devToken).toBeUndefined();
    expect(await prisma.passwordResetToken.count()).toBe(before);
  });
});
