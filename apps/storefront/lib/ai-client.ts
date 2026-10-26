/**
 * AI Client (گام ۱۸-۳) — اینترفیس سازگار OpenAI برای چت‌بات مشتری.
 * محتوای گفتگو، خطای خام شبکه و payload در مرورگر log نمی‌شوند.
 */

import type { AIChatMessage, AIChatResponse, AIChatStreamChunk } from "@/types/ai";

const CHAT_ENDPOINT = "/api/ai/chat";

/**
 * ارسال درخواست چت غیر-streaming
 */
export async function aiChat(messages: AIChatMessage[]): Promise<string> {
  const payload = { messages, stream: false };
  const res = await fetch(CHAT_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  }).catch(() => {
    throw new Error("چت موقتاً در دسترس نیست؛ کمی بعد دوباره تلاش کن.");
  });

  const data = (await res.json().catch(() => null)) as (AIChatResponse | { error?: string }) | null;

  if (!res.ok) {
    // بدنهٔ خطا ساختار {code, message} دارد — پیام انسانی را استخراج کن، نه JSON خام
    const msg = data && "message" in data && typeof data.message === "string" && data.message
      ? data.message
      : data && "error" in data && typeof data.error === "string"
        ? data.error
        : "چت موقتاً در دسترس نیست؛ کمی بعد دوباره تلاش کن.";
    throw new Error(`AI chat failed: ${msg}`);
  }

  if (!data || !("content" in data) || !data.content) {
    throw new Error("AI returned empty content");
  }

  return data.content;
}

/**
 * ارسال درخواست چت streaming — reader برای SSE
 *
 * `options.signal` لغوِ سمت کاربر (دکمهٔ توقف) را ممکن می‌کند؛ لغو با پیام تمیزِ
 * «پاسخ متوقف شد» به UI می‌رسد، نه خطای خام. onDone/onError حداکثر یک‌بار صدا
 * می‌خورند تا loading هرگز گیر نکند و state دوبار تنظیم نشود.
 */
export interface AIChatStreamOptions {
  signal?: AbortSignal;
}

export async function aiChatStream(
  messages: AIChatMessage[],
  onChunk: (chunk: string) => void,
  onDone: () => void,
  onError: (error: string) => void,
  options: AIChatStreamOptions = {}
): Promise<void> {
  const payload = { messages, stream: true };
  // سقف زمانی با لغو کاربر ترکیب می‌شود؛ هر کدام زودتر برسد، جریان می‌ایستد.
  const timeoutSignal = AbortSignal.timeout(60_000);
  const signal = options.signal ? AbortSignal.any([timeoutSignal, options.signal]) : timeoutSignal;
  // دقیقاً-یک‌بار: بعد از اولین پایان، هیچ callback دیگری اجرا نمی‌شود.
  let settled = false;
  const finish = (fn: () => void) => {
    if (settled) return;
    settled = true;
    fn();
  };
  const cancelled = () => options.signal?.aborted === true;
  const CANCELLED_MESSAGE = "پاسخ متوقف شد؛ اگر خواستی دوباره بفرست.";
  const NETWORK_MESSAGE = "چت موقتاً در دسترس نیست؛ کمی بعد دوباره تلاش کن.";

  const res = await fetch(CHAT_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  }).catch(() => {
    finish(() => onError(cancelled() ? CANCELLED_MESSAGE : NETWORK_MESSAGE));
    return null;
  });

  if (!res || !res.ok || !res.body) {
    if (res && !cancelled()) {
      const text = await res.text().catch(() => "");
      // بدنهٔ خطا {code, message} است — پیام تمیز را به UI بده، نه JSON خام یا کد HTTP
      let msg = NETWORK_MESSAGE;
      try {
        const parsed = JSON.parse(text) as { message?: string } | null;
        if (parsed && typeof parsed.message === "string" && parsed.message.trim()) msg = parsed.message;
      } catch {
        // بدنهٔ غیر-JSON از بالادست نباید به UI نشت کند.
      }
      finish(() => onError(msg));
    } else if (cancelled()) {
      finish(() => onError(CANCELLED_MESSAGE));
    } else {
      finish(() => onError(NETWORK_MESSAGE));
    }
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]" || data === '{"done":true}') {
          finish(onDone);
          return;
        }
        try {
          const parsed = JSON.parse(data) as AIChatStreamChunk;
          if (parsed.error) {
            finish(() => onError(parsed.error!));
            return;
          }
          if (parsed.chunk) onChunk(parsed.chunk);
        } catch {
          // ignore parse errors on partial chunks
        }
      }
    }
    // انتهای جریان بدون [DONE] (قطع SSE) — محتوای رسیده حفظ و loading آزاد می‌شود
    finish(onDone);
  } catch {
    // قطع ارتباط یا لغو کاربر وسط جریان؛ خطا هرگز خام به UI نمی‌رسد
    finish(() => onError(cancelled() ? CANCELLED_MESSAGE : "ارتباط چت قطع شد؛ دوباره تلاش کن."));
  } finally {
    reader.releaseLock();
  }
}

/**
 * 헬퍼: تبدیل تاریخچه چت به فرمت API
 */
export function toAPIMessages(
  history: Array<{ role: "user" | "assistant"; content: string }>
): AIChatMessage[] {
  return history.slice(-10).map((m) => ({
    role: m.role,
    content: m.content.slice(0, 2000),
  }));
}