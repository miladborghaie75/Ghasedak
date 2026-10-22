/**
 * شاهد زندهٔ ارسال ایمیل — **سرور SMTP واقعی روی TLS واقعی**، بدون هیچ mock.
 *
 * چرا جدا از `phase19-reset-channel.spec.ts`: آن تست سوکت TLS را جعل می‌کند تا
 * منطق dispatcher را سریع بسنجد. جعل سوکت ثابت نمی‌کند که پروتکل روی سیم
 * واقعاً کار می‌کند (مثلاً ترتیب مراحل، پایان‌بندی DATA با `.`، طول خط).
 * این فایل یک `tls.Server` محلی با گواهی خودامضا بالا می‌آورد، dispatcher را
 * به آن وصل می‌کند و **متن پیام رسیده به سرور** را با توکن واقعی DB مقایسه می‌کند.
 *
 * اجرا (opt-in؛ در اجرای عادی تست‌ها skip است چون به openssl و پورت آزاد نیاز دارد):
 *
 *   cd apps/api && SMTP_WITNESS=1 \
 *     DATABASE_URL="postgresql://postgres:rehearsal-pw@127.0.0.1:55433/wave1rehearsal3" \
 *     npx jest --runInBand test/witness-smtp-live.spec.ts
 *
 * گواهی خودامضا در پوشهٔ موقت ساخته و در پایان پاک می‌شود — هیچ کلیدی در repo نیست.
 */
import "reflect-metadata";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as tls from "node:tls";

import { PrismaService } from "../src/prisma/prisma.service";
import { NotificationDispatcherService } from "../src/events/notification-dispatcher.service";
import { SmsProvidersService } from "../src/events/sms-providers.service";

jest.setTimeout(120_000);

const ENABLED = process.env.SMTP_WITNESS === "1";
const suite = ENABLED ? describe : describe.skip;

suite("شاهد SMTP زنده — گواهی واقعی، پروتکل واقعی، پیام واقعی", () => {
  let prisma: PrismaService;
  let dispatcher: NotificationDispatcherService;
  let server: tls.Server;
  let certDir = "";
  let port = 0;
  const transcript: string[] = [];
  let body = "";
  const token = `wit-${Date.now().toString(36)}-token`;
  const to = `witness-${Date.now().toString(36)}@ghasedak.test`;
  let notifId = "";
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    certDir = mkdtempSync(join(tmpdir(), "ghasedak-smtp-witness-"));
    const key = join(certDir, "key.pem");
    const cert = join(certDir, "cert.pem");
    // گواهی یک‌روزه فقط برای loopback — نه در گیت، نه دائم
    execFileSync(
      "openssl",
      ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1", "-subj", "/CN=localhost"],
      { stdio: "ignore" },
    );

    server = tls.createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (sock) => {
      let authStep = 0;
      let inData = false;
      const reply = (line: string) => sock.write(line + "\r\n");
      reply("220 smtp.witness ESMTP");
      sock.on("data", (buf) => {
        const text = buf.toString();
        transcript.push(text);
        if (inData) {
          body += text;
          // dispatcher کل پیام + خط پایان `.` را در یک write می‌فرستد
          if (/\r\n\.\s*$/.test(text) || text.trim() === ".") {
            inData = false;
            reply("250 OK queued as WITNESS1");
          }
          return;
        }
        const first = text.split("\r\n")[0] ?? "";
        if (/^EHLO /i.test(first)) reply("250-smtp.witness\r\n250-AUTH LOGIN\r\n250 OK");
        else if (/^AUTH LOGIN$/i.test(first)) {
          authStep = 1;
          reply("334 VXNlcm5hbWU6");
        } else if (authStep === 1) {
          authStep = 2;
          reply("334 UGFzc3dvcmQ6");
        } else if (authStep === 2) {
          authStep = 3;
          reply("235 Authentication successful");
        } else if (/^MAIL FROM:/i.test(first)) reply("250 OK");
        else if (/^RCPT TO:/i.test(first)) reply("250 OK");
        else if (/^DATA$/i.test(first)) {
          inData = true;
          reply("354 End data with <CR><LF>.<CR><LF>");
        } else if (/^QUIT$/i.test(first)) {
          reply("221 Bye");
          sock.end();
        } else reply("250 OK");
      });
      sock.on("error", () => undefined);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    port = typeof addr === "object" && addr ? addr.port : 0;

    prisma = new PrismaService();
    await prisma.$connect();
    dispatcher = new NotificationDispatcherService(prisma, new SmsProvidersService(prisma));

    for (const k of ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"]) saved[k] = process.env[k];
    process.env.SMTP_HOST = "127.0.0.1";
    process.env.SMTP_PORT = String(port);
    process.env.SMTP_USER = "witness@ghasedak.test";
    process.env.SMTP_PASS = "witness-secret";
    process.env.SMTP_FROM = "witness@ghasedak.test";

    const n = await prisma.notification.create({
      data: {
        channel: "EMAIL",
        templateKey: "password-reset:customer",
        to,
        payload: { message: `بازیابی رمز قاصدک — کد یک‌بارمصرف (۳۰ دقیقه): ${token}` },
        status: "QUEUED",
      },
    });
    notifId = n.id;
  });

  afterAll(async () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await prisma.notification.deleteMany({ where: { id: notifId } }).catch(() => undefined);
    await prisma.$disconnect();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (certDir) rmSync(certDir, { recursive: true, force: true });
  });

  it("dispatcher پیام را روی TLS واقعی می‌فرستد و متن/توکنش در سرور دیده می‌شود", async () => {
    expect(port).toBeGreaterThan(0);
    const r = await dispatcher.dispatchOne(notifId);
    expect(r).toMatchObject({ state: "SENT", error: null });

    const row = await prisma.notification.findUniqueOrThrow({ where: { id: notifId } });
    expect(row.status).toBe("SENT");
    expect(row.sentAt).not.toBeNull();

    const wire = transcript.join("");
    // پروتکل واقعاً طی شده — نه فقط «وضعیت SENT در DB»
    expect(wire).toContain("AUTH LOGIN");
    expect(wire).toContain("MAIL FROM:<witness@ghasedak.test>");
    expect(wire).toContain(`RCPT TO:<${to}>`);
    expect(wire).toContain("DATA");
    // متن واقعی رسیده به سرور، شامل توکن یک‌بارمصرف
    expect(body).toContain(token);
    expect(body).toContain("بازیابی رمز قاصدک");
    // هیچ متن ساختگی/قالب‌نام در پیام نیست
    expect(body).not.toContain("— password-reset:customer");
  });
});
