/**
 * گام ۲۲ (بستهٔ B — بند B2) — گارد CSRF اکشن‌های حساس مالی/حسابداری.
 *
 * اثبات پذیرش: درخواست مینتِ بدون توکن و با Origin غریب رد می‌شود (۴۰۳)؛
 * با هدر double-submit صحیح یا Origin هم‌مبدأ می‌گذرد؛ درخواست سمت‌سرور
 * (بدون Origin/Referer — callback درگاه، fetch سروری ادمین) عبور می‌کند؛
 * متدهای امن (GET/HEAD/OPTIONS) اصلاً بررسی نمی‌شوند.
 * بدون DB — guard خالص است و با بافت mock تست می‌شود.
 */
import "reflect-metadata";
import type { ExecutionContext } from "@nestjs/common";
import { ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { CsrfGuard, allowedCsrfOrigins, originAllowed } from "../src/auth/csrf.guard";

/** بافت guard با metadata روشن — بدون Nest runtime */
function makeGuard(needed = true): CsrfGuard {
  const reflector = {
    getAllAndOverride: () => needed,
  } as unknown as Reflector;
  return new CsrfGuard(reflector);
}

/** درخواست mock با هدرهای دلخواه */
function ctx(headers: Record<string, string>, method = "POST"): ExecutionContext {
  const req = { method, headers } as unknown as Request;
  return {
    getHandler: () => ((): void => undefined),
    getClass: () => class Dummy {},
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
}

const TOKEN = "csrf-test-token-123";

describe("Phase 22 — CSRF guard (اکشن‌های حساس)", () => {
  const guard = makeGuard();

  it("Origin غریب + بدون توکن → ۴۰۳", () => {
    expect(() =>
      guard.canActivate(ctx({ origin: "https://evil.example", cookie: `csrf_token=${TOKEN}` })),
    ).toThrow(ForbiddenException);
  });

  it("Origin مجاز (از CORS_ORIGINS) → عبور", () => {
    const prev = process.env.CORS_ORIGINS;
    process.env.CORS_ORIGINS = "https://panel.ghasedak.test,https://www.lebaszirghasedak.ir";
    try {
      expect(
        guard.canActivate(ctx({ origin: "https://panel.ghasedak.test", cookie: `csrf_token=${TOKEN}` })),
      ).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.CORS_ORIGINS;
      else process.env.CORS_ORIGINS = prev;
    }
  });

  it("بدون Origin و بدون Referer → عبور (درخواست سمت‌سرور؛ مرورگر cross-site همیشه Origin دارد)", () => {
    expect(guard.canActivate(ctx({ cookie: `csrf_token=${TOKEN}` }))).toBe(true);
  });

  it("double-submit درست → عبور حتی با Origin غریب (توکن فقط از مبدأ هم‌مبدأ خوانده می‌شود)", () => {
    expect(
      guard.canActivate(
        ctx({
          origin: "https://evil.example",
          cookie: `csrf_token=${TOKEN}`,
          "x-csrf-token": TOKEN,
        }),
      ),
    ).toBe(true);
  });

  it("توکن نابرابر + Origin غریب → ۴۰۳", () => {
    expect(() =>
      guard.canActivate(
        ctx({
          origin: "https://evil.example",
          cookie: `csrf_token=${TOKEN}`,
          "x-csrf-token": "different",
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it("متد امن (GET) حتی با Origin غریب عبور می‌کند — چیزی نوشته نمی‌شود", () => {
    expect(guard.canActivate(ctx({ origin: "https://evil.example" }, "GET"))).toBe(true);
  });

  it("Referer هم‌مبدأ (بدون Origin) → عبور؛ Referer غریب → ۴۰۳", () => {
    const prev = process.env.CORS_ORIGINS;
    process.env.CORS_ORIGINS = "https://panel.ghasedak.test";
    try {
      expect(
        guard.canActivate(
          ctx({ referer: "https://panel.ghasedak.test/orders?page=2", cookie: `csrf_token=${TOKEN}` }),
        ),
      ).toBe(true);
      expect(() =>
        guard.canActivate(ctx({ referer: "https://evil.example/x", cookie: `csrf_token=${TOKEN}` })),
      ).toThrow(ForbiddenException);
    } finally {
      if (prev === undefined) delete process.env.CORS_ORIGINS;
      else process.env.CORS_ORIGINS = prev;
    }
  });

  it("بدون @RequireCsrf (metadata خاموش) → بدون توجه به Origin عبور", () => {
    expect(makeGuard(false).canActivate(ctx({ origin: "https://evil.example" }))).toBe(true);
  });

  it("در dev هر origin لوکال (هر پورتی) مجاز است؛ در prod فقط فهرست env", () => {
    const devEnv = { NODE_ENV: "development", CORS_ORIGINS: "https://a.test" } as NodeJS.ProcessEnv;
    expect(allowedCsrfOrigins(devEnv)).toEqual(["https://a.test"]);
    // پورت‌های dev (۳۱۱۱/۳۲۰۰/…) نباید ۴۰۳ بخورند — چک localhost به میزبان است نه پورت
    expect(originAllowed("http://localhost:3200", allowedCsrfOrigins(devEnv), devEnv)).toBe(true);
    expect(originAllowed("http://127.0.0.1:3111", allowedCsrfOrigins(devEnv), devEnv)).toBe(true);
    expect(originAllowed("https://evil.example", allowedCsrfOrigins(devEnv), devEnv)).toBe(false);

    const prodEnv = { NODE_ENV: "production", CSRF_ALLOWED_ORIGINS: "https://b.test" } as NodeJS.ProcessEnv;
    const prod = allowedCsrfOrigins(prodEnv);
    expect(prod).toEqual(["https://b.test"]);
    expect(originAllowed("https://b.test/", prod, prodEnv)).toBe(true); // اسلش انتهایی بی‌اثر است
    expect(originAllowed("https://b.test.evil.example", prod, prodEnv)).toBe(false); // ترفند پسوند دامنه
    expect(originAllowed("http://localhost:3200", prod, prodEnv)).toBe(false); // در prod localhost مجاز نیست
  });
});
