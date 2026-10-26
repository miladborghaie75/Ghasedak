/**
 * تاریخچهٔ محلی چت — ذخیره/بازیابی امن در localStorage (بخش ۲، طرح دستیارها).
 *
 * قواعد:
 *  - حداکثر نگهداری ۷ روز؛ تاریخچهٔ کهنه‌تر دور ریخته می‌شود (انقضای خودکار).
 *  - سقف تعداد پیام و طول محتوای هر پیام هنگام ذخیره و بازیابی.
 *  - JSON خراب، شکل قدیمی/نامعتبر و storage خراب (quota، حالت خصوصی) هرگز crash
 *    نمی‌سازند؛ تاریخچهٔ نامعتبر دور ریخته می‌شود و ذخیره بی‌صدا انصراف می‌دهد.
 *  - پاک‌شدن کامل با `clearChatHistory`؛ دکمهٔ «پاک کردن چت» همین را صدا می‌زند.
 */

export interface StoredChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** ISO — در ذخیره‌ساز همیشه رشته است */
  timestamp: string;
}

/** ورودی ذخیره: timestamp می‌تواند Date باشد (state کامپوننت) */
export type ChatHistoryInput = Omit<StoredChatMessage, "timestamp"> & { timestamp: Date | string };

export const CHAT_HISTORY_KEY = "ghasedak-chat-session";
/** حداکثر عمر تاریخچه — ۷ روز (برنامهٔ بخش ۲) */
export const CHAT_HISTORY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const CHAT_HISTORY_MAX_MESSAGES = 50;
export const CHAT_HISTORY_MAX_CONTENT_LENGTH = 2_000;
/** سقف کل رشتهٔ ذخیره‌شده — جلوگیری از پر شدن quota مرورگر */
export const CHAT_HISTORY_MAX_STORED_CHARS = 150_000;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** storage پیش‌فرض مرورگر؛ اگر در دسترس یا مجاز نباشد null برمی‌گردد (SSR هم شامل). */
function defaultStorage(): StorageLike | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    // دسترسی به localStorage ممکن است خودش خطا بدهد (سیاست مرورگر/iframe)
    return null;
  }
}

function toISO(value: Date | string): string | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** اعتبارسنجی یک پیام ذخیره‌شده — پیام ناقص دور ریخته می‌شود، نه کل تاریخچه. */
function sanitizeMessage(raw: unknown, now: number): StoredChatMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as { id?: unknown; role?: unknown; content?: unknown; timestamp?: unknown };
  if (m.role !== "user" && m.role !== "assistant") return null;
  if (typeof m.content !== "string") return null;
  const content = m.content.trim().slice(0, CHAT_HISTORY_MAX_CONTENT_LENGTH);
  if (!content) return null;
  const timestamp = typeof m.timestamp === "string" || m.timestamp instanceof Date ? toISO(m.timestamp) : null;
  if (!timestamp) return null;
  // پیامِ کهتر از حد نگهداری هم دور ریخته می‌شود
  if (now - new Date(timestamp).getTime() > CHAT_HISTORY_MAX_AGE_MS) return null;
  return {
    id: typeof m.id === "string" && m.id ? m.id : `${new Date(timestamp).getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    role: m.role,
    content,
    timestamp,
  };
}

/**
 * بازیابی و اعتبارسنجی تاریخچه از localStorage.
 * خروجی: پیام‌های معتبر (حداکثر ۵۰ تا، بدون قدیمی‌تر از ۷ روز) یا null وقتی
 * چیز معتبری نیست (اولین بازدید، JSON خراب، شکل قدیمی، انقضا، storage خراب).
 */
export function loadChatHistory(
  now: number = Date.now(),
  storage: StorageLike | null = defaultStorage(),
): StoredChatMessage[] | null {
  if (!storage) return null;
  let raw: string | null = null;
  try {
    raw = storage.getItem(CHAT_HISTORY_KEY);
  } catch {
    return null; // storage خواندنی نیست
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearChatHistory(undefined, storage); // JSON خراب — پاک شود تا هر بار دوباره خوانده نشود
    return null;
  }

  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { messages?: unknown }).messages)) {
    // شکل قدیمی/نامعتبر — تاریخچه قابل اعتماد نیست
    clearChatHistory(undefined, storage);
    return null;
  }

  // انقضای کل تاریخچه بر اساس آخرین فعالیت (updatedAt پوشش؛ در نبودش، آخرین پیام)
  const envelope = parsed as { updatedAt?: unknown };
  const updatedAt = typeof envelope.updatedAt === "string" ? toISO(envelope.updatedAt) : null;
  const messages = (parsed as { messages: unknown[] }).messages;
  const lastStamp = (() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i] as { timestamp?: unknown } | null;
      const iso = m && (typeof m.timestamp === "string" || m.timestamp instanceof Date) ? toISO(m.timestamp) : null;
      if (iso) return iso;
    }
    return null;
  })();
  const lastActivity = updatedAt ?? lastStamp;
  if (!lastActivity || now - new Date(lastActivity).getTime() > CHAT_HISTORY_MAX_AGE_MS) {
    clearChatHistory(undefined, storage); // منقضی — پاک شود
    return null;
  }

  const valid: StoredChatMessage[] = [];
  for (const item of messages) {
    const message = sanitizeMessage(item, now);
    if (message) valid.push(message);
  }
  if (valid.length === 0) return null;
  return valid.slice(-CHAT_HISTORY_MAX_MESSAGES);
}

/**
 * ذخیرهٔ تاریخچه با سقف‌ها؛ خطای quota/storage بی‌صدا جذب می‌شود (چت نباید
 * به‌خاطر پر بودن ذخیره‌ساز مرورگر از کار بیفتد).
 */
export function saveChatHistory(
  messages: readonly ChatHistoryInput[],
  sessionId: string,
  now: number = Date.now(),
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!storage) return;
  const valid: StoredChatMessage[] = [];
  for (const item of messages) {
    const message = sanitizeMessage(item, now);
    if (message) valid.push(message);
  }
  if (valid.length === 0) return;
  try {
    let payload = JSON.stringify({
      sessionId,
      messages: valid.slice(-CHAT_HISTORY_MAX_MESSAGES),
      updatedAt: new Date(now).toISOString(),
    });
    // سقف اندازه: قدیمی‌ها تا جا شدن در سقف حذف می‌شوند
    while (payload.length > CHAT_HISTORY_MAX_STORED_CHARS && valid.length > 1) {
      valid.splice(0, Math.max(1, Math.floor(valid.length / 4)));
      payload = JSON.stringify({
        sessionId,
        messages: valid.slice(-CHAT_HISTORY_MAX_MESSAGES),
        updatedAt: new Date(now).toISOString(),
      });
    }
    if (payload.length > CHAT_HISTORY_MAX_STORED_CHARS) return;
    storage.setItem(CHAT_HISTORY_KEY, payload);
  } catch {
    // ذخیره نشد؛ تاریخچهٔ قبلی دست‌نخورده می‌ماند و چت ادامه می‌یابد
  }
}

/** پاک‌شدن کامل تاریخچه؛ خطای storage جذب می‌شود. */
export function clearChatHistory(
  _sessionIdHint?: string,
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.removeItem(CHAT_HISTORY_KEY);
  } catch {
    // هیچ‌کاری نکن — پاک‌کردن نباید چت را بشکند
  }
}
