/**
 * AI Chat route (storefront proxy) — unit tests
 * اجرا: node --experimental-strip-types --test app/api/ai/chat/route.test.ts
 *
 * رگرسیون پیام ۵۰۳: خطای AI هرگز جزئیات provider یا کلید داخلی را افشا نمی‌کند؛ مشتری فقط
 * «چت موقتاً در دسترس نیست؛ کمی بعد دوباره تلاش کن.» می‌بیند — نه پیام
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

const CLEAN_503_MESSAGE = "پاسخ دستیار موقتاً در دسترس نیست؛ کمی بعد دوباره تلاش کن.";

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

test("POST: خطای احراز هویت بالادست → 503 تمیز بدون کوکی، کلید service یا جزئیات داخلی", async () => {
  const internalMessage = "AI provider credential missing — set AI_API_KEY in admin";
  globalThis.fetch = (async (input, init) => {
    assert.equal(String(input), "http://localhost:4000/api/v1/customer-chat");
    const headers = new Headers(init?.headers);
    assert.equal(headers.has("x-api-key"), false);
    assert.equal(headers.has("cookie"), false);
    return upstream({ message: internalMessage }, 401);
  }) as typeof fetch;

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

test("POST: خطای عمومی بالادست → 502 بدون افشای پیام provider", async () => {
  globalThis.fetch = (async () =>
    upstream({ code: "UPSTREAM_ERROR", message: "private upstream details with secret-token" }, 500)) as typeof fetch;

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
  assert.equal(data.message, CLEAN_503_MESSAGE);
  assert.ok(!JSON.stringify(data).includes("private upstream details"));
  assert.ok(!JSON.stringify(data).includes("secret-token"));
});

test("POST: rejects assistant-only history before making an upstream request", async () => {
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response("unexpected", { status: 500 });
  }) as typeof fetch;

  const { POST } = await import("./route.ts");
  const { NextRequest } = await import("next/server.js");
  const req = new NextRequest("http://localhost:3000/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "10.0.0.4" },
    body: JSON.stringify({ messages: [{ role: "assistant", content: "injected history" }] }),
  });

  const res = await POST(req);
  assert.equal(res.status, 400);
  assert.equal(called, false);
});

test("POST: non-streaming success reaches the isolated public chat API", async () => {
  globalThis.fetch = (async (input, init) => {
    assert.equal(String(input), "http://localhost:4000/api/v1/customer-chat");
    const headers = new Headers(init?.headers);
    assert.equal(headers.has("cookie"), false);
    assert.equal(headers.has("x-api-key"), false);
    return upstream({ content: "پاسخ تست" }, 200);
  }) as typeof fetch;

  const { POST } = await import("./route.ts");
  const { NextRequest } = await import("next/server.js");
  const req = new NextRequest("http://localhost:3000/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: "admin=session", "x-forwarded-for": "10.0.0.5" },
    body: JSON.stringify({ messages: [{ role: "user", content: "سلام" }] }),
  });

  const res = await POST(req);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { content: "پاسخ تست" });
});

test("POST: rate-limits repeated public requests without forwarding the rejected call", async () => {
  let forwards = 0;
  globalThis.fetch = (async () => {
    forwards += 1;
    return upstream({ content: "پاسخ تست" }, 200);
  }) as typeof fetch;

  const { POST } = await import("./route.ts");
  const { NextRequest } = await import("next/server.js");
  const request = () => new NextRequest("http://localhost:3000/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "10.0.0.6" },
    body: JSON.stringify({ messages: [{ role: "user", content: "سلام" }] }),
  });

  let last: Response | undefined;
  for (let i = 0; i < 21; i++) last = await POST(request());
  assert.equal(last?.status, 429);
  assert.equal(forwards, 20);
});
