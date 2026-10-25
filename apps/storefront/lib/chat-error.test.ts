/**
 * ChatWidget error display — unit tests
 * اجرا: node --experimental-strip-types --test lib/chat-error.test.ts
 *
 * رگرسیون ۵۰۳: پیام تمیز سرور باید عیناً در حباب دستیار نمایش داده شود،
 * نه پیام عمومی «متأسفم، خطایی رخ داد».
 */
import assert from "node:assert/strict";
import { test } from "node:test";

const CLEAN_503_MESSAGE = "چت موقتاً در دسترس نیست؛ کمی بعد دوباره تلاش کن.";

test("resolveAssistantError: پیام ۵۰۳ سرور عیناً برگردانده می‌شود", async () => {
  const { resolveAssistantError } = await import("./chat-error.ts");
  assert.equal(resolveAssistantError(CLEAN_503_MESSAGE), CLEAN_503_MESSAGE);
});

test("resolveAssistantError: متن خالی/فاصله‌ای → پیام عمومی", async () => {
  const { resolveAssistantError, CHAT_ERROR_FALLBACK } = await import("./chat-error.ts");
  assert.equal(resolveAssistantError(""), CHAT_ERROR_FALLBACK);
  assert.equal(resolveAssistantError("   "), CHAT_ERROR_FALLBACK);
  assert.equal(resolveAssistantError(null), CHAT_ERROR_FALLBACK);
  assert.equal(resolveAssistantError(undefined), CHAT_ERROR_FALLBACK);
});

test("resolveAssistantError: پیام عمومی هرگز جایگزین پیام تمیز نمی‌شود", async () => {
  const { resolveAssistantError, CHAT_ERROR_FALLBACK } = await import("./chat-error.ts");
  const result = resolveAssistantError(CLEAN_503_MESSAGE);
  assert.notEqual(result, CHAT_ERROR_FALLBACK);
  assert.ok(result.includes("چت موقتاً در دسترس نیست"));
});
