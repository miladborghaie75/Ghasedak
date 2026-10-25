/**
 * گام ۱۴ (`[F1-15]`) — کانال بازیابی رمز + تحویل واقعی پیام:
 *  ۱) مشتری با ایمیل: انتخاب کانال ایمیل → توکن + ردیف ایمیل در صف
 *  ۲) مشتری بدون ایمیل: انتخاب ایمیل → پاسخ عمومی، **هیچ افت بی‌اطلاع به پیامک**
 *  ۳) پیش‌فرض نقش‌محور دست‌نخورده (مشتری=پیامک، ادمین=ایمیل)
 *  ۴) کانال نامعتبر/پیامک برای ادمین → خطای صریح
 *  ۵) dispatcher: بدون credential → QUEUED (بدون موفقیت جعلی)
 *  ۶) dispatcher با SMTP: → SENT + متن پیام شامل توکن (باگ «متن نرسیدن توکن» رفع شد)
 *
 * نکته دربارهٔ (۶): لایهٔ سوکت TLS با ماژول جعلی شبیه‌سازی می‌شود (پروتکل
 * مرحله‌به‌مرحله اجرا می‌شود)، چون سرور SMTP واقعی در CI در دسترس نیست.
 * شاهد پروتکل واقعی روی سرور TLS محلی جداگانه گرفته می‌شود:
 * `test/witness-smtp-live.spec.ts` (اجرا با `SMTP_WITNESS=1`).
 */
import "reflect-metadata";

/** ثبت نوشته‌ها و پاسخ‌های سرور جعلی SMTP — قبل از import dispatcher مقدار می‌گیرد */
const smtpWrites: string[] = [];
jest.mock("node:tls", () => {
  const { EventEmitter } = require("node:events") as typeof import("node:events");
  /**
   * سرور جعلی با حالت: فرمان‌های AUTH LOGIN باید به‌ترتیب ۳۳۴/۳۳۴/۲۳۵ بگیرند،
   * وگرنه dispatcher (که هر پاسخ را با مرحلهٔ بعدی می‌سنجد) قفل می‌شود.
   */
  class FakeSocket extends EventEmitter {
    private authLines = 0;
    private inData = false;
    write(line: string): boolean {
      smtpWrites.push(line);
      const l = line.trim();
      let reply = "250 OK";
      if (/^EHLO /i.test(l)) reply = "250-ghasedak.test\r\n250 OK";
      else if (/^AUTH LOGIN$/i.test(l)) reply = "334 VXNlcm5hbWU6";
      else if (/^[A-Za-z0-9+/=]{8,}$/.test(l)) {
        this.authLines += 1;
        reply = this.authLines === 1 ? "334 UGFzc3dvcmQ6" : "235 Authentication successful";
      } else if (/^MAIL FROM:/i.test(l)) reply = "250 OK";
      else if (/^RCPT TO:/i.test(l)) reply = "250 OK";
      else if (/^DATA$/i.test(l)) {
        this.inData = true;
        reply = "354 End data with <CR><LF>.<CR><LF>";
      } else if (/^QUIT$/i.test(l)) reply = "221 Bye";
      else if (this.inData) {
        this.inData = false;
        reply = "250 OK queued as ABC123";
      }
      setTimeout(() => this.emit("data", Buffer.from(reply + "\r\n")), 0);
      return true;
    }
    setTimeout(): void {
      /* no-op — سرور جعلی هیچ‌وقت timeout نمی‌دهد */
    }
    destroy(): void {
      /* no-op */
    }
  }
  return {
    connect: (_opts: unknown, cb?: () => void) => {
      const s = new FakeSocket();
      if (cb) setImmediate(cb);
      // بنر خوش‌آمد 220 — سرور واقعی همین را اول می‌فرستد؛ بدون آن dispatcher
      // منتظر مرحلهٔ اول می‌ماند و تا ابد هنگ می‌کند (timeout جعلی no-op است).
      setImmediate(() => s.emit("data", Buffer.from("220 ghasedak.test ESMTP\r\n")));
      return s;
    },
  };
});

import { BadRequestException } from "@nestjs/common";
import { PrismaService } from "../src/prisma/prisma.service";
import { PasswordResetService } from "../src/auth/password-reset.service";
import { PasswordResetController } from "../src/auth/password-reset.controller";
import { NotificationDispatcherService } from "../src/events/notification-dispatcher.service";
import { SmsProvidersService } from "../src/events/sms-providers.service";

jest.setTimeout(120_000);

const MARK = `${Date.now().toString(36)}`;

describe("Phase 19 — reset channel + message delivery (F1-15)", () => {
  let prisma: PrismaService;
  let svc: PasswordResetService;
  let ctl: PasswordResetController;
  let dispatcher: NotificationDispatcherService;
  const userIds: string[] = [];
  const mobileOnly = `0990${String(Date.now()).slice(-6)}5`;
  const emailCustomer = `cust-${MARK}@ghasedak.test`;
  const password = "Cust#Pass1";

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    svc = new PasswordResetService(prisma);
    ctl = new PasswordResetController(svc);
    dispatcher = new NotificationDispatcherService(prisma, new SmsProvidersService(prisma));

    const withEmail = await prisma.user.create({
      data: {
        email: emailCustomer,
        mobile: `0991${String(Date.now()).slice(-6)}6`,
        passwordHash: await PasswordResetService.hashPassword(password),
        name: "کانال ایمیل (TEST)",
        role: "CUSTOMER",
        status: "ACTIVE",
      },
    });
    const withoutEmail = await prisma.user.create({
      data: {
        mobile: mobileOnly,
        passwordHash: await PasswordResetService.hashPassword(password),
        name: "بدون ایمیل (TEST)",
        role: "CUSTOMER",
        status: "ACTIVE",
      },
    });
    userIds.push(withEmail.id, withoutEmail.id);
  });

  afterAll(async () => {
    await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
    await prisma.notification.deleteMany({ where: { templateKey: { in: ["password-reset:customer", "password-reset:admin"] }, to: { contains: MARK } } }).catch(() => undefined);
    await prisma.notification.deleteMany({ where: { templateKey: { in: ["password-reset:customer", "password-reset:admin"] }, to: { in: [mobileOnly, emailCustomer] } } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("مشتری با ایمیل: کانال انتخاب‌شده رعایت می‌شود (توکن + صف ایمیل)", async () => {
    const r = await svc.request({ purpose: "customer", identifier: emailCustomer, channel: "email" });
    expect(r.channel).toBe("email");
    expect(r.devToken).toBeTruthy();
    const row = await prisma.passwordResetToken.findFirst({ where: { userId: userIds[0] } });
    expect(row?.channel).toBe("email");
    expect(row?.sentTo).toBe(emailCustomer);
    const notif = await prisma.notification.findFirst({ where: { to: emailCustomer, templateKey: "password-reset:customer" } });
    expect(notif?.channel).toBe("EMAIL");
    expect(notif?.status).toBe("QUEUED");
    // متن توکن همین حالا در payload هست (و dispatcher باید همان را بفرستد)
    expect(JSON.stringify(notif?.payload)).toContain(r.devToken);
  });

  it("انتخاب ایمیل برای حسابی که ایمیل ندارد: پاسخ عمومی، بدون افت بی‌اطلاع به پیامک", async () => {
    const beforeTokens = await prisma.passwordResetToken.count({ where: { userId: userIds[1] } });
    const beforeSms = await prisma.notification.count({ where: { to: mobileOnly, templateKey: "password-reset:customer" } });

    // شماره در حالت «ایمیل» ورودی نامعتبر است → خطای صریح، نه سکوت
    await expect(svc.request({ purpose: "customer", identifier: mobileOnly, channel: "email" })).rejects.toMatchObject({
      response: { code: "VALIDATION_ERROR" },
    });

    // ایمیل ثبت‌نشده → همان پاسخ عمومی anti-enumeration، بدون توکن و بدون هیچ ردیفی
    const unknownEmail = `nobody-${MARK}@ghasedak.test`;
    const r = await svc.request({ purpose: "customer", identifier: unknownEmail, channel: "email" });
    expect(r.requested).toBe(true);
    expect(r.channel).toBe("email");
    expect(r.devToken).toBeUndefined();
    expect(await prisma.passwordResetToken.count({ where: { userId: userIds[1] } })).toBe(beforeTokens);
    expect(await prisma.notification.count({ where: { to: unknownEmail } })).toBe(0);
    // هیچ پیامکی بی‌اطلاع کاربر ساخته نشده — کاربر باید خودش کانال را عوض کند
    expect(await prisma.notification.count({ where: { to: mobileOnly, templateKey: "password-reset:customer" } })).toBe(beforeSms);
  });

  it("پیش‌فرض نقش‌محور دست‌نخورده: مشتری=پیامک، ادمین=ایمیل", async () => {
    const c = await svc.request({ purpose: "customer", identifier: mobileOnly });
    expect(c.channel).toBe("sms");
    expect(c.devToken).toBeTruthy();
    const row = await prisma.passwordResetToken.findFirst({ where: { userId: userIds[1] }, orderBy: { createdAt: "desc" } });
    expect(row?.channel).toBe("sms");

    const adminEmail = `admin-${MARK}@ghasedak.test`;
    const admin = await prisma.user.create({
      data: { email: adminEmail, passwordHash: await PasswordResetService.hashPassword(password), name: "ادمین تست", role: "SUPER_ADMIN", status: "ACTIVE" },
    });
    userIds.push(admin.id);
    const a = await svc.request({ purpose: "admin", identifier: adminEmail });
    expect(a.channel).toBe("email");
  });

  it("کانال نامعتبر و «پیامک برای ادمین» → خطای صریح", async () => {
    await expect(ctl.forgot({ purpose: "customer", identifier: mobileOnly, channel: "telegram" })).rejects.toThrow(BadRequestException);
    await expect(ctl.forgot({ purpose: "admin", identifier: `admin-${MARK}@ghasedak.test`, channel: "sms" })).rejects.toMatchObject({
      response: { code: "CHANNEL_NOT_ALLOWED" },
    });
  });

  it("dispatcher بدون credential → QUEUED با پیام گویا (هیچ موفقیت جعلی)", async () => {
    const saved = { host: process.env.SMTP_HOST, user: process.env.SMTP_USER, pass: process.env.SMTP_PASS };
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    try {
      const notif = await prisma.notification.findFirstOrThrow({ where: { to: emailCustomer, templateKey: "password-reset:customer" } });
      await prisma.notification.update({ where: { id: notif.id }, data: { status: "QUEUED", lastError: null, sentAt: null } });
      const r = await dispatcher.dispatchOnce(50);
      expect(r.notConfigured).toBeGreaterThanOrEqual(1);
      const after = await prisma.notification.findUniqueOrThrow({ where: { id: notif.id } });
      expect(after.status).toBe("QUEUED");
      expect(after.sentAt).toBeNull();
      expect(after.lastError ?? "").toContain("NOT_CONFIGURED");
    } finally {
      if (saved.host) process.env.SMTP_HOST = saved.host;
      if (saved.user) process.env.SMTP_USER = saved.user;
      if (saved.pass) process.env.SMTP_PASS = saved.pass;
    }
  });

  it("dispatcher با SMTP → SENT + متن پیام شامل توکن (باگ متن نرسیدن توکن رفع شد)", async () => {
    const saved = { host: process.env.SMTP_HOST, port: process.env.SMTP_PORT, user: process.env.SMTP_USER, pass: process.env.SMTP_PASS, from: process.env.SMTP_FROM };
    process.env.SMTP_HOST = "smtp.test.local";
    process.env.SMTP_PORT = "465";
    process.env.SMTP_USER = "mailer@ghasedak.test";
    process.env.SMTP_PASS = "secret";
    process.env.SMTP_FROM = "mailer@ghasedak.test";
    smtpWrites.length = 0;
    try {
      const req = await svc.request({ purpose: "customer", identifier: emailCustomer, channel: "email" });
      const token = req.devToken!;
      const notif = await prisma.notification.findFirstOrThrow({
        where: { to: emailCustomer, templateKey: "password-reset:customer", status: "QUEUED" },
        orderBy: { createdAt: "desc" },
      });
      const r = await dispatcher.dispatchOnce(50);
      expect(r.sent).toBeGreaterThanOrEqual(1);
      const after = await prisma.notification.findUniqueOrThrow({ where: { id: notif.id } });
      expect(after.status).toBe("SENT");
      expect(after.sentAt).not.toBeNull();
      expect(after.attempts).toBeGreaterThanOrEqual(1);
      // فرمان‌های پروتکل واقعی طی شده‌اند
      const wire = smtpWrites.join("\n");
      expect(wire).toContain("AUTH LOGIN");
      expect(wire).toContain("MAIL FROM:<mailer@ghasedak.test>");
      expect(wire).toContain(`RCPT TO:<${emailCustomer}>`);
      // **متن پیام حاوی توکن** — نه فقط نام قالب
      expect(wire).toContain(token);
      expect(wire).not.toContain("— password-reset:customer");
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        const envKey = `SMTP_${k.toUpperCase()}`;
        if (v === undefined) delete process.env[envKey];
        else process.env[envKey] = v;
      }
    }
  });

  /**
   * دکمهٔ «تلاش دوباره» ادمین پیش‌تر `dispatchOnce(50)` صدا می‌زد؛ یعنی retry یک
   * ردیف می‌توانست ۵۰ ردیف دیگر صف را هم بفرستد — ارسال ناخواستهٔ پیام‌هایی که
   * ادمین درخواست نکرده بود. `dispatchOne` دامنه را به همان یک ردیف محدود می‌کند.
   */
  it("retry هدف‌دار: dispatchOne فقط همان ردیف را می‌فرستد (بدون drain کل صف)", async () => {
    const saved = { host: process.env.SMTP_HOST, port: process.env.SMTP_PORT, user: process.env.SMTP_USER, pass: process.env.SMTP_PASS, from: process.env.SMTP_FROM };
    process.env.SMTP_HOST = "smtp.test.local";
    process.env.SMTP_PORT = "465";
    process.env.SMTP_USER = "mailer@ghasedak.test";
    process.env.SMTP_PASS = "secret";
    process.env.SMTP_FROM = "mailer@ghasedak.test";
    try {
      const mk = (suffix: string) =>
        prisma.notification.create({
          data: {
            channel: "EMAIL",
            to: `retry-${suffix}-${MARK}@ghasedak.test`,
            templateKey: "password-reset:customer",
            payload: { message: `کد بازیابی ${suffix}: 123456` },
            status: "QUEUED",
          },
        });
      const [target, bystander] = await Promise.all([mk("a"), mk("b")]);

      const r = await dispatcher.dispatchOne(target.id);
      expect(r.state).toBe("SENT");
      expect(r.error).toBeNull();

      const [afterTarget, afterBystander] = await Promise.all([
        prisma.notification.findUniqueOrThrow({ where: { id: target.id } }),
        prisma.notification.findUniqueOrThrow({ where: { id: bystander.id } }),
      ]);
      expect(afterTarget.status).toBe("SENT");
      expect(afterTarget.attempts).toBe(1);
      // شاهد اصلی: ردیف همسایه دست‌نخورده ماند
      expect(afterBystander.status).toBe("QUEUED");
      expect(afterBystander.attempts).toBe(0);
      expect(afterBystander.sentAt).toBeNull();

      // ردیف غیرQUEUED دوباره ارسال نمی‌شود — هیچ ارسال تکراری
      await prisma.notification.update({ where: { id: bystander.id }, data: { status: "FAILED", lastError: "SMTP_FAIL: rejected" } });
      expect(await dispatcher.dispatchOne(bystander.id)).toMatchObject({ state: "SKIPPED", error: "STATUS_FAILED" });

      // شناسهٔ ناموجود → NOT_FOUND، بدون exception
      expect(await dispatcher.dispatchOne("does-not-exist")).toMatchObject({ state: "SKIPPED", error: "NOT_FOUND" });
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        const envKey = `SMTP_${k.toUpperCase()}`;
        if (v === undefined) delete process.env[envKey];
        else process.env[envKey] = v;
      }
    }
  });
});
