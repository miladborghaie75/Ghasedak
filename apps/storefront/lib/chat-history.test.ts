/**
 * Chat history (storefront) — unit tests
 * اجرا: node --experimental-strip-types --test lib/chat-history.test.ts
 *
 * پذیرش بخش ۲: انقضای خودکار (fake-timer)، پاک‌شدن کامل، JSON خراب/قدیمی،
 * سقف تعداد/اندازه، و رفتار امن برای storage خراب/غیرفعال.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

const KEY = "ghasedak-chat-session";
const DAY_MS = 24 * 60 * 60 * 1000;
/** لحظهٔ مرجع ثابت — ۱۴۰۵/۰۸/۰۵ ساعت ۱۲ ظهر به وقت تهران (UTC+3:30) */
const T0 = Date.UTC(2026, 10, 26, 8, 30);

/** storage شبیه‌سازی‌شدهٔ مرورگر؛ حالت‌های خراب را می‌توان فعال کرد */
function fakeStorage(initial?: string) {
  const map = new Map<string, string>();
  if (initial !== undefined) map.set(KEY, initial);
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    dump: () => map.get(KEY),
  };
}

function message(overrides: Partial<{ id: string; role: "user" | "assistant"; content: string; timestamp: string }> = {}) {
  return {
    id: overrides.id ?? "m1",
    role: overrides.role ?? "user",
    content: overrides.content ?? "سلام",
    timestamp: overrides.timestamp ?? new Date(T0).toISOString(),
  };
}

async function mod() {
  return import("./chat-history.ts");
}

test("ذخیره و بازیابی: پیام معتبر برمی‌گردد و کلید با شکل درست نوشته می‌شود", async () => {
  const { saveChatHistory, loadChatHistory } = await mod();
  const storage = fakeStorage();
  saveChatHistory([message()], "sess-1", T0, storage);
  const loaded = loadChatHistory(T0, storage);
  assert.ok(loaded);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].content, "سلام");
  assert.equal(loaded[0].role, "user");
  const raw = JSON.parse(storage.dump()!) as { sessionId: string; updatedAt: string };
  assert.equal(raw.sessionId, "sess-1");
  assert.equal(raw.updatedAt, new Date(T0).toISOString());
});

test("انقضای خودکار: تاریخچهٔ ۶ روزه معتبر است و ۸ روزه پاک می‌شود (fake-timer)", async () => {
  const { saveChatHistory, loadChatHistory } = await mod();
  const storage = fakeStorage();
  saveChatHistory([message()], "sess-1", T0, storage);

  // ۶ روز بعد: هنوز معتبر
  const sixDaysLater = loadChatHistory(T0 + 6 * DAY_MS, storage);
  assert.ok(sixDaysLater);
  assert.equal(sixDaysLater.length, 1);

  // ۸ روز بعد (بیش از سقف ۷ روز): دور ریخته و کلید هم پاک شده
  const eightDaysLater = loadChatHistory(T0 + 8 * DAY_MS, storage);
  assert.equal(eightDaysLater, null);
  assert.equal(storage.dump(), undefined);
});

test("انقضا بر اساس آخرین فعالیت است؛ پیامِ داخل پنجرهٔ ۷ روز با فعالیت اخیر می‌ماند", async () => {
  const { saveChatHistory, loadChatHistory } = await mod();
  const storage = fakeStorage();
  // پیام ۳ روزه در لحظهٔ ذخیره (updatedAt = T0+5d)
  saveChatHistory(
    [message({ id: "old", timestamp: new Date(T0 + 2 * DAY_MS).toISOString() })],
    "sess-1",
    T0 + 5 * DAY_MS,
    storage,
  );
  const loaded = loadChatHistory(T0 + 5 * DAY_MS + 1000, storage);
  assert.ok(loaded);
  assert.equal(loaded.length, 1, "پیامِ داخل پنجرهٔ ۷ روز باید بماند");
});

test("JSON خراب: null برمی‌گردد و کلید نامعتبر پاک می‌شود", async () => {
  const { loadChatHistory } = await mod();
  const storage = fakeStorage("{definitely not json");
  assert.equal(loadChatHistory(T0, storage), null);
  assert.equal(storage.dump(), undefined);
});

test("شکل قدیمی/نامعتبر (آبجکت بدون messages، messages غیر آرایه) رد و پاک می‌شود", async () => {
  const { loadChatHistory } = await mod();
  for (const legacy of ["{}", "[]", '{"messages":"oops"}', "42", '"str"']) {
    const storage = fakeStorage(legacy);
    assert.equal(loadChatHistory(T0, storage), null, `شکل ${legacy} نباید پذیرفته شود`);
    assert.equal(storage.dump(), undefined, `شکل ${legacy} باید پاک شود`);
  }
});

test("پیام‌های نامعتبر داخل آرایه دور ریخته می‌شوند نه کل تاریخچه", async () => {
  const { loadChatHistory } = await mod();
  const storage = fakeStorage(
    JSON.stringify({
      sessionId: "s",
      updatedAt: new Date(T0).toISOString(),
      messages: [
        message({ id: "good" }),
        { id: "bad-role", role: "system", content: "دستور", timestamp: new Date(T0).toISOString() },
        { id: "bad-content", role: "user", content: 42, timestamp: new Date(T0).toISOString() },
        { id: "bad-time", role: "user", content: "سلام", timestamp: "not-a-date" },
        { id: "empty", role: "user", content: "   ", timestamp: new Date(T0).toISOString() },
      ],
    }),
  );
  const loaded = loadChatHistory(T0, storage);
  assert.ok(loaded);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].id, "good");
});

test("سقف تعداد: بیش از ۵۰ پیام هنگام ذخیره و بازیابی کوتاه می‌شود", async () => {
  const { saveChatHistory, loadChatHistory } = await mod();
  const storage = fakeStorage();
  const many = Array.from({ length: 80 }, (_, i) =>
    message({ id: `m${i}`, content: `پیام ${i}` }),
  );
  saveChatHistory(many, "sess-1", T0, storage);
  const loaded = loadChatHistory(T0, storage);
  assert.ok(loaded);
  assert.equal(loaded.length, 50);
  assert.equal(loaded[49].id, "m79", "آخرین پیام‌ها باید نگه داشته شوند");
});

test("سقف اندازه: محتوای بلند بریده و کل payload در سقف ذخیره می‌شود", async () => {
  const { saveChatHistory, loadChatHistory, CHAT_HISTORY_MAX_CONTENT_LENGTH, CHAT_HISTORY_MAX_STORED_CHARS } = await mod();
  const storage = fakeStorage();
  saveChatHistory(
    [message({ content: "x".repeat(50_000) }), message({ id: "m2", role: "assistant", content: "y".repeat(50_000) })],
    "sess-1",
    T0,
    storage );
  assert.ok((storage.dump() ?? "").length <= CHAT_HISTORY_MAX_STORED_CHARS);
  const loaded = loadChatHistory(T0, storage);
  assert.ok(loaded);
  for (const m of loaded) assert.ok(m.content.length <= CHAT_HISTORY_MAX_CONTENT_LENGTH);
});

test("پاک‌شدن کامل: clearChatHistory کلید را حذف می‌کند و بازیابی null می‌دهد", async () => {
  const { saveChatHistory, loadChatHistory, clearChatHistory } = await mod();
  const storage = fakeStorage();
  saveChatHistory([message()], "sess-1", T0, storage);
  assert.ok(loadChatHistory(T0, storage));
  clearChatHistory("sess-1", storage);
  assert.equal(storage.dump(), undefined);
  assert.equal(loadChatHistory(T0, storage), null);
});

test("storage خراب: خواندن/نوشتن/پاک‌کردن خطا نمی‌دهد و چت از کار نمی‌افتد", async () => {
  const { loadChatHistory, saveChatHistory, clearChatHistory } = await mod();
  const throwing = {
    getItem: () => {
      throw new Error("SecurityError: storage disabled");
    },
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
    removeItem: () => {
      throw new Error("SecurityError");
    },
  };
  assert.equal(loadChatHistory(T0, throwing), null);
  assert.doesNotThrow(() => saveChatHistory([message()], "s", T0, throwing));
  assert.doesNotThrow(() => clearChatHistory("s", throwing));
});

test("storage غیرفعال (null): همه توابع بی‌اثر و بدون خطا هستند", async () => {
  const { loadChatHistory, saveChatHistory, clearChatHistory } = await mod();
  assert.equal(loadChatHistory(T0, null), null);
  assert.doesNotThrow(() => saveChatHistory([message()], "s", T0, null));
  assert.doesNotThrow(() => clearChatHistory("s", null));
});

test("تاریخچهٔ بی‌فعالیتِ مانده: ۷٫۵ روز بعد از آخرین فعالیت منقضی و پاک می‌شود", async () => {
  const { loadChatHistory } = await mod();
  // فعالیتِ آخر: T0+6.5d — پیام معتبر، ولی ۷٫۵ روز از آن گذشته
  const storage = fakeStorage(
    JSON.stringify({
      sessionId: "s",
      updatedAt: new Date(T0 + 6.5 * DAY_MS).toISOString(),
      messages: [message({ content: "پیام قدیمی", timestamp: new Date(T0 + 6.5 * DAY_MS).toISOString() })],
    }),
  );
  assert.equal(loadChatHistory(T0 + 14 * DAY_MS, storage), null);
  assert.equal(storage.dump(), undefined, "تاریخچهٔ منقضی باید پاک شود");
});
