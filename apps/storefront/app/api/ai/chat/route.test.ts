/**
 * AI Chat route (storefront proxy) — unit tests
 * اجرا: node --experimental-strip-types --test app/api/ai/chat/route.test.ts
 *
 * رگرسیون پیام ۵۰۳: وقتی کلید سرویس/AI پیکربندی نیست، مشتری باید
 * «چت موقتاً در دسترس نیست؛ کمی بعد دوباره تلاش کن.» ببیند — نه پیام
 * داخلی مدیرپسند بالادست (بند ۱۱۱).
 */
import assert from "node:assert/strict";
import { test, beforeEach, after } from "node:test";
import { registerHooks } from "node:module";

// next@15.5.26 هیچ «exports» map ندارد؛ «next/server» خام در Node رزولو نمی‌شود
// ولی «next/server.js» کار می‌کند. هوکِ رزولوشن همین یک بازنویسی را انجام می‌دهد.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    return nextResolve(specifier, context);
  },
});

const originalFetch = globalThis.fetch;

const CLEAN_503_MESSAGE = "چت موقتاً در دسترس نیست؛ کمی بعد دوباره تلاش کن.";

function upstream(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  // پیش‌فرض: بالادست سالم — هر تست در صورت نیاز بازنویسی می‌کند
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ content: "پاسخ تست" }), { status: 200 })) as typeof fetch;
});

after(() => {
  globalThis.fetch = originalFetch;
});

test("POST: بالادست 401/403 → 503 با پیام تمیز «چت موقتاً در دسترس نیست»", async () => {
  const internalMessage = "AI provider credential missing — set AI_API_KEY in admin";
  globalThis.fetch = (async () =>
    upstream({ message: internalMessage }, 401)) as typeof fetch;

  const { POST } = await import("./route.ts");
  const { NextRequest } = await import("next/server.js");

  const req = new NextRequest("http://localhost:3000/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "10.0.0.1" },
    body: JSON.stringify({ messages: [{ role: "user", content: "سلام" }], stream: true }),
  });

  const res = await POST(req);
  assert.equal(res.status, 503);
  const data = (await res.json()) as { code?: string; message?: string };
  assert.equal(data.code, "REQUIRES_CREDENTIAL");
  assert.equal(data.message, CLEAN_503_MESSAGE);
  // پیام داخلی مدیرپسند هرگز به مشتری نشت نمی‌کند
  assert.ok(!JSON.stringify(data).includes("AI_API_KEY"));
});

test("POST: بالادست REQUIRES_CREDENTIAL → 503 با همان پیام تمیز", async () => {
  globalThis.fetch = (async () =>
    upstream({ code: "REQUIRES_CREDENTIAL", message: "مدیر: AI_BASE_URL تنظیم نشده" }, 503)) as typeof fetch;

  const { POST } = await import("./route.ts");
  const { NextRequest } = await import("next/server.js");

  const req = new NextRequest("http://localhost:3000/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "10.0.0.2" },
    body: JSON.stringify({ messages: [{ role: "user", content: "سلام" }] }),
  });

  const res = await POST(req);
  assert.equal(res.status, 503);
  const data = (await res.json()) as { code?: string; message?: string };
  assert.equal(data.code, "REQUIRES_CREDENTIAL");
  assert.equal(data.message, CLEAN_503_MESSAGE);
  assert.ok(!String(data.message).includes("مدیر"));
});

test("POST: خطای عمومی بالادست → 502 و بدون دگرگونی پیام تمیز ۵۰۳", async () => {
  globalThis.fetch = (async () =>
    upstream({ code: "UPSTREAM_ERROR", message: "خطای سرور: 500" }, 500)) as typeof fetch;

  const { POST } = await import("./route.ts");
  const { NextRequest } = await import("next/server.js");

  const req = new NextRequest("http://localhost:3000/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "10.0.0.3" },
    body: JSON.stringify({ messages: [{ role: "user", content: "سلام" }] }),
  });

  const res = await POST(req);
  assert.equal(res.status, 502);
  const data = (await res.json()) as { code?: string; message?: string };
  assert.equal(data.code, "UPSTREAM_ERROR");
});
