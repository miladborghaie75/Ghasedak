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

test("aiChat: درخواست موفق → محتوای پاسخ برگردانده شود و گفتگو وارد لاگ نشود", async () => {
  let called = false;
  const loggedContent: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args: unknown[]) => loggedContent.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => loggedContent.push(args.map(String).join(" "));
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    called = true;
    assert.ok(String(input).includes("/api/ai/chat"));
    assert.equal(init?.method, "POST");
    return new Response(JSON.stringify({ content: "پاسخ تست" }), { status: 200 });
  };

  try {
    const { aiChat } = await import("./ai-client.ts");
    const result = await aiChat([{ role: "user", content: "سلام" }]);
    assert.equal(result, "پاسخ تست");
    assert.equal(called, true);
    assert.deepEqual(loggedContent, []);
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
});

test("aiChat: خطای HTTP غیر JSON → پیام عمومی بدون پاسخ خام بالادست", async () => {
  globalThis.fetch = async () => new Response("private upstream diagnostics", { status: 502 });
  const { aiChat } = await import("./ai-client.ts");
  await assert.rejects(() => aiChat([{ role: "user", content: "سلام" }]), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, "AI chat failed: چت موقتاً در دسترس نیست؛ کمی بعد دوباره تلاش کن.");
    assert.ok(!error.message.includes("private upstream diagnostics"));
    return true;
  });
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

test("aiChatStream: پاسخ غیر JSON → متن بالادست را افشا نمی‌کند", async () => {
  globalThis.fetch = async () => new Response("private provider diagnostics", { status: 502 });
  const { aiChatStream } = await import("./ai-client.ts");
  let receivedError = "";
  await aiChatStream([{ role: "user", content: "سلام" }], () => {}, () => {}, (err) => { receivedError = err; });
  assert.equal(receivedError, "چت موقتاً در دسترس نیست؛ کمی بعد دوباره تلاش کن.");
  assert.ok(!receivedError.includes("private provider diagnostics"));
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

test("aiChat: خطای شبکهٔ غیر-streaming پیام خام exception را افشا نمی‌کند", async () => {
  globalThis.fetch = async () => { throw new Error("private network details"); };
  const { aiChat } = await import("./ai-client.ts");
  await assert.rejects(() => aiChat([{ role: "user", content: "سلام" }]), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, "چت موقتاً در دسترس نیست؛ کمی بعد دوباره تلاش کن.");
    assert.ok(!error.message.includes("private network details"));
    return true;
  });
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

test("aiChatStream: لغو کاربر (signal) → پیام تمیز «پاسخ متوقف شد» و onDone صدا نمی‌خورد", async () => {
  const controller = new AbortController();
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    // شبیه‌سازی fetch واقعی: با لغو سیگنال reject می‌کند
    return await new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  }) as typeof fetch;

  const { aiChatStream } = await import("./ai-client.ts");
  let receivedError = "";
  let done = false;
  const promise = aiChatStream(
    [{ role: "user", content: "سلام" }],
    () => {},
    () => { done = true; },
    (err) => { receivedError = err; },
    { signal: controller.signal },
  );
  controller.abort();
  await promise;
  assert.equal(receivedError, "پاسخ متوقف شد؛ اگر خواستی دوباره بفرست.");
  assert.ok(!receivedError.includes("AbortError"), "نام خطای خام نباید به UI برسد");
  assert.equal(done, false);
});

test("aiChatStream: قطع SSE بدون [DONE] → onDone صدا می‌خورد (loading گیر نمی‌کند)", async () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"chunk":"نصف پاسخ"}\n\n'));
      controller.close(); // بدون [DONE] — جریان زودتر تمام شده
    },
  });
  globalThis.fetch = async () => new Response(stream, { status: 200 });

  const { aiChatStream } = await import("./ai-client.ts");
  let done = false;
  const chunks: string[] = [];
  await aiChatStream(
    [{ role: "user", content: "سلام" }],
    (chunk) => chunks.push(chunk),
    () => { done = true; },
    () => { assert.fail("جریان سالم است و نباید خطا بدهد"); },
  );
  assert.equal(done, true);
  assert.deepEqual(chunks, ["نصف پاسخ"], "محتوای رسیده باید حفظ شود");
});

test("aiChatStream: خطای شبکهٔ وسط جریان → پیام تمیز «ارتباط چت قطع شد» بدون جزئیات خام", async () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"chunk":"شروع"}\n\n'));
      controller.error(new Error("private socket details"));
    },
  });
  globalThis.fetch = async () => new Response(stream, { status: 200 });

  const { aiChatStream } = await import("./ai-client.ts");
  let receivedError = "";
  let done = false;
  await aiChatStream(
    [{ role: "user", content: "سلام" }],
    () => {},
    () => { done = true; },
    (err) => { receivedError = err; },
  );
  assert.equal(receivedError, "ارتباط چت قطع شد؛ دوباره تلاش کن.");
  assert.ok(!receivedError.includes("private socket details"));
  assert.equal(done, false);
});

test("aiChatStream: timeout (TimeoutError) → پیام تمیز شبکه‌ای، نه نام خطا", async () => {
  globalThis.fetch = async () => {
    throw new DOMException("The operation timed out.", "TimeoutError");
  };
  const { aiChatStream } = await import("./ai-client.ts");
  let receivedError = "";
  await aiChatStream(
    [{ role: "user", content: "سلام" }],
    () => {},
    () => { assert.fail("باید خطا بدهد"); },
    (err) => { receivedError = err; },
  );
  assert.equal(receivedError, "چت موقتاً در دسترس نیست؛ کمی بعد دوباره تلاش کن.");
  assert.ok(!receivedError.includes("TimeoutError"));
});

test("aiChatStream: onDone/onError دقیقاً یک‌بار صدا می‌خورند (حتی با [DONE] اضافه)", async () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"chunk":"پاسخ"}\n\ndata: [DONE]\n\n'));
      controller.enqueue(encoder.encode('data: {"chunk":"تکهٔ بعد از done"}\n\ndata: [DONE]\n\n'));
      controller.close();
    },
  });
  globalThis.fetch = async () => new Response(stream, { status: 200 });

  const { aiChatStream } = await import("./ai-client.ts");
  let doneCount = 0;
  let errorCount = 0;
  await aiChatStream(
    [{ role: "user", content: "سلام" }],
    () => {},
    () => { doneCount += 1; },
    () => { errorCount += 1; },
  );
  assert.equal(doneCount, 1);
  assert.equal(errorCount, 0);
});