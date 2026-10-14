/**
 * گام F0-4 — پیکربندی بوت.
 *
 * چیزهایی که این تست قفل می‌کند:
 *  ۱) `PORT` نامعتبر (مخصوصاً `PORT=0` = پورت تصادفی در Node) هرگز بی‌صدا
 *     پذیرفته نمی‌شود؛ به پیش‌فرض برمی‌گردد و هشدار می‌دهد.
 *  ۲) پیام خطای «DB در دسترس نیست» هرگز کاربر/رمز را لو نمی‌دهد.
 */
import "reflect-metadata";
import { describeDbTarget, dbUnreachableMessage, firstErrorLine, resolvePort, DEFAULT_API_PORT } from "../src/common/boot-config";

describe("Phase 15 — پیکربندی بوت (F0-4)", () => {
  describe("resolvePort", () => {
    it("مقدار نبود/خالی → پیش‌فرض بدون هشدار", () => {
      expect(resolvePort(undefined)).toEqual({ port: DEFAULT_API_PORT });
      expect(resolvePort("")).toEqual({ port: DEFAULT_API_PORT });
      expect(resolvePort("   ")).toEqual({ port: DEFAULT_API_PORT });
    });

    it("پورت صحیح (با فاصلهٔ اضافه) دقیقاً همان می‌ماند", () => {
      expect(resolvePort("4100")).toEqual({ port: 4100 });
      expect(resolvePort(" 4000 ")).toEqual({ port: 4000 });
      expect(resolvePort("65535")).toEqual({ port: 65535 });
    });

    it("PORT=0 → پیش‌فرض + هشدار صریح دربارهٔ پورت تصادفی", () => {
      const r = resolvePort("0");
      expect(r.port).toBe(DEFAULT_API_PORT);
      expect(r.warning).toContain("PORT=0");
      expect(r.warning).toContain("تصادفی");
    });

    it("مقادیر نامعتبر دیگر → پیش‌فرض + هشدار", () => {
      for (const bad of ["-5", "abc", "70000", "12.5", "1e3"]) {
        const r = resolvePort(bad);
        expect([bad, r.port, typeof r.warning]).toEqual([bad, DEFAULT_API_PORT, "string"]);
      }
    });
  });

  describe("هدف DB و پیام خطا", () => {
    it("هدف اتصال را بدون کاربر/رمز خلاصه می‌کند", () => {
      const url = "postgresql://postgres:rehearsal-pw@127.0.0.1:55433/wave1rehearsal3";
      const target = describeDbTarget(url);
      expect(target).toBe("127.0.0.1:55433/wave1rehearsal3");
      expect(target).not.toContain("rehearsal-pw");
      expect(target).not.toContain("postgres:");
    });

    it("پورت نبود → پیش‌فرض 5432 در متن؛ ورودی نامعتبر → پیام روشن", () => {
      expect(describeDbTarget("postgresql://u:p@db.internal/ghasedak")).toBe("db.internal:5432/ghasedak");
      expect(describeDbTarget("not-a-url")).toContain("نامعتبر");
      expect(describeDbTarget(undefined)).toContain("تنظیم نشده");
    });

    it("علت خطا از اولین سطر غیرخالی می‌آید (پیام Prisma با \\n شروع می‌شود)", () => {
      const err = Object.assign(new Error("\nInvalid `prisma.$queryRaw()` invocation:\n\nCan't reach database server at 127.0.0.1:5999"), {
        name: "PrismaClientInitializationError",
        code: "P1001",
      });
      expect(firstErrorLine(err)).toContain("Can't reach database server");
      expect(firstErrorLine(new Error("\n\n"))).toBe("Error");
      expect(firstErrorLine(Object.assign(new Error("\n"), { name: "PrismaClientInitializationError", code: "P1001" }))).toBe(
        "PrismaClientInitializationError (P1001)",
      );
    });

    it("پیام خطای DB: هدف + راهنما را دارد و رمز را لو نمی‌دهد", () => {
      const url = "postgresql://postgres:rehearsal-pw@127.0.0.1:55433/wave1rehearsal3";
      const msg = dbUnreachableMessage(url, new Error("Can't reach database server at 127.0.0.1:55433"));
      expect(msg).toContain("127.0.0.1:55433/wave1rehearsal3");
      expect(msg).toContain("run-local.sh");
      expect(msg).toContain("55433");
      expect(msg).not.toContain("rehearsal-pw");
    });
  });
});
