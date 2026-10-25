/**
 * گام ۲۲ (بستهٔ B — بند B1) — مهاجرت هش رمز به argon2id با rehash هنگام ورود.
 *
 * پذیرش:
 *  ۱) ورود با `passwordHash` قدیمی scrypt → موفق؛ بعد از ورود مقدار DB با `$argon2id$` شروع می‌شود.
 *  ۲) ورود با هش argon2id → موفق.
 *  ۳) رمز غلط → همان خطای BAD_CREDENTIALS فعلی (و هش دست نمی‌خورد).
 */
import "reflect-metadata";
import { randomBytes, scryptSync } from "node:crypto";
import { UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "../src/prisma/prisma.service";
import { AuthService, hashInfo, hashPasswordArgon2id, verifyPassword } from "../src/auth/auth.service";

jest.setTimeout(120_000);

/** هش قدیمی — دقیقاً همان قالب و پارامترهای قبلی `scrypt$salt$hash` */
function legacyHash(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 }).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

describe("Phase 22 itemB1 — argon2id migration (rehash-on-login)", () => {
  let prisma: PrismaService;
  let auth: AuthService;
  const tag = `a2${Date.now()}${Math.floor(Math.random() * 100000)}`;
  const email = `argon2-${tag}@ghasedak.test`;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    auth = new AuthService(prisma);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } }).catch(() => undefined);
    await prisma.adminSession.deleteMany({ where: { user: { email } } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("تشخیص scheme: هش قدیمی scrypt و هش جدید argon2id", async () => {
    expect(hashInfo(legacyHash("x"))?.scheme).toBe("scrypt");
    const phc = await hashPasswordArgon2id("x");
    expect(phc.startsWith("$argon2id$")).toBe(true);
    expect(hashInfo(phc)?.scheme).toBe("argon2id");
    expect(hashInfo("garbage")).toBeNull();
    expect(hashInfo(null)).toBeNull();
  });

  it("ورود با هش قدیمی scrypt → موفق؛ بعد از ورود DB با $argon2id$ شروع می‌شود", async () => {
    const password = `Legacy#Pass${tag}`;
    await prisma.user.create({
      data: {
        email,
        passwordHash: legacyHash(password),
        name: "Argon2 Migration (TEST)",
        role: "SUPER_ADMIN",
        status: "ACTIVE",
      },
    });
    const login = await auth.login(email, password);
    expect(login.token).toBeTruthy();

    const after = await prisma.user.findUnique({ where: { email }, select: { passwordHash: true } });
    expect(after?.passwordHash?.startsWith("$argon2id$")).toBe(true);
    expect(hashInfo(after?.passwordHash)?.scheme).toBe("argon2id");
  });

  it("ورود با هش argon2id → موفق (هش تغییر نمی‌کند)", async () => {
    const password = `Modern#Pass${tag}`;
    const phc = await hashPasswordArgon2id(password);
    await prisma.user.update({ where: { email }, data: { passwordHash: phc } });
    const login = await auth.login(email, password);
    expect(login.token).toBeTruthy();
    const after = await prisma.user.findUnique({ where: { email }, select: { passwordHash: true } });
    expect(after?.passwordHash).toBe(phc);
  });

  it("رمز غلط → BAD_CREDENTIALS و هش دست نمی‌خورد", async () => {
    const before = await prisma.user.findUnique({ where: { email }, select: { passwordHash: true } });
    await expect(auth.login(email, "wrong-password")).rejects.toThrow("ایمیل یا رمز نادرست است.");
    await auth.login(email, "wrong-password").catch((e: unknown) => {
      const ex = e as { getStatus?: () => number; getResponse?: () => unknown };
      expect(ex.getStatus?.()).toBe(401);
      expect(ex.getResponse?.()).toMatchObject({ code: "BAD_CREDENTIALS" });
    });
    const after = await prisma.user.findUnique({ where: { email }, select: { passwordHash: true } });
    expect(after?.passwordHash).toBe(before?.passwordHash);
  });

  it("سازگاری verifyPassword: هر دو قالب + هش خراب بدون استثنا رد می‌شود", async () => {
    expect((await verifyPassword("a", "not-a-hash")).ok).toBe(false);
    const legacy = legacyHash("secret-legacy");
    expect((await verifyPassword("secret-legacy", legacy)).ok).toBe(true);
    expect((await verifyPassword("secret-legacy", legacy)).needsRehash).toBe(true);
    const modern = await hashPasswordArgon2id("secret-modern");
    expect((await verifyPassword("secret-modern", modern)).ok).toBe(true);
    expect((await verifyPassword("secret-modern", modern)).needsRehash).toBe(false);
  });
});
