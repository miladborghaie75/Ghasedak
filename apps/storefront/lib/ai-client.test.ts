/**
 * AI Client (storefront) — unit tests
 * اجرا: node --experimental-strip-types --test lib/ai-client.test.ts
 */
import assert from "node:assert/strict";
import { test, beforeEach, after } from "node:test";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = async () => {
    return new Response(JSON.stringify({ content: "" }), { status: 200 });
  };
});

after(() => {
  globalThis.fetch = originalFetch;
});

test("aiChat: درخواست موفق → محتوای پاسخ برگردانده شود", async () => {
  let called = false;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    called = true;
    assert.ok(String(input).includes("/api/ai/chat"));
    assert.equal(init?.method, "POST");
    return new Response(JSON.stringify({ content: "پاسخ تست" }), { status: 200 });
  };

  const { aiChat } = await import("./ai-client.ts");
  const result = await aiChat([{ role: "user", content: "سلام" }]);
  assert.equal(result, "پاسخ تست");
  assert.equal(called, true);
});

test("aiChat: خطای HTTP → پرتاب خطا", async () => {
  globalThis.fetch = async () => {
    return new Response(JSON.stringify({ error: "VALIDATION_ERROR" }), { status: 400 });
  };

  const { aiChat } = await import("./ai-client.ts");
  try {
    await aiChat([{ role: "user", content: "سلام" }]);
    assert.fail("should have thrown");
  } catch (err) {
    assert.ok(err instanceof Error);
    assert.ok(err.message.includes("AI chat failed"));
  }
});

test("toAPIMessages: تاریخچه را تریم و محدود می‌کند", async () => {
  const { toAPIMessages } = await import("./ai-client.ts");
  const history = Array.from({ length: 15 }, (_, i) => ({
    role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
    content: "x".repeat(3000),
  }));
  const result = toAPIMessages(history);
  assert.equal(result.length, 10); // slice(-10)
  assert.equal(result[0].content.length, 2000); // slice(0, 2000)
});

test("aiChatStream: پاسخ ۵۰۳ → onError پیام تمیز «چت موقتاً در دسترس نیست» می‌گیرد، نه JSON خام/کد HTTP", async () => {
  const CLEAN_503_MESSAGE = "چت موقتاً در دسترس نیست؛ کمی بعد دوباره تلاش کن.";
  globalThis.fetch = async () => {
    return new Response(
      JSON.stringify({ code: "REQUIRES_CREDENTIAL", message: CLEAN_503_MESSAGE }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  };

  const { aiChatStream } = await import("./ai-client.ts");
  const chunks: string[] = [];
  let done = false;
  let receivedError = "";
  await aiChatStream(
    [{ role: "user", content: "سلام" }],
    (chunk) => chunks.push(chunk),
    () => { done = true; },
    (err) => { receivedError = err; }
  );

  assert.equal(receivedError, CLEAN_503_MESSAGE);
  assert.ok(!receivedError.includes("HTTP 503"), "نباید کد HTTP خام به UI برسد");
  assert.ok(!receivedError.includes("REQUIRES_CREDENTIAL"), "نباید JSON خام به UI برسد");
  assert.equal(chunks.length, 0);
  assert.equal(done, false);
});

test("aiChat: خطای ۵۰۳ غیر-streaming → پرتاب خطا با پیام تمیز سرور", async () => {
  const CLEAN_503_MESSAGE = "چت موقتاً در دسترس نیست؛ کمی بعد دوباره تلاش کن.";
  globalThis.fetch = async () => {
    return new Response(
      JSON.stringify({ code: "REQUIRES_CREDENTIAL", message: CLEAN_503_MESSAGE }),
      { status: 503 }
    );
  };

  const { aiChat } = await import("./ai-client.ts");
  try {
    await aiChat([{ role: "user", content: "سلام" }]);
    assert.fail("should have thrown");
  } catch (err) {
    assert.ok(err instanceof Error);
    assert.ok(err.message.includes("AI chat failed"));
    assert.ok(err.message.includes(CLEAN_503_MESSAGE), "پیام تمیز سرور باید در خطا حفظ شود");
    assert.ok(!err.message.includes("REQUIRES_CREDENTIAL"), "کد داخلی نباید به UI نشت کند");
  }
});

test("aiChatStream: SSE chunk handling", async () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"chunk":"سلام"}\n\n'));
      controller.enqueue(encoder.encode('data: {"chunk":" چطور می‌تونم کمکت کنم؟"}\n\n'));
      controller.enqueue(encoder.encode('data: {"done":true}\n\n'));
      controller.close();
    },
  });

  globalThis.fetch = async () => {
    return new Response(stream, { status: 200 });
  };

  const { aiChatStream } = await import("./ai-client.ts");
  const chunks: string[] = [];
  await aiChatStream(
    [{ role: "user", content: "سلام" }],
    (chunk) => chunks.push(chunk),
    () => {},
    (err) => { throw new Error(err); }
  );
  assert.deepEqual(chunks, ["سلام", " چطور می‌تونم کمکت کنم؟"]);
});