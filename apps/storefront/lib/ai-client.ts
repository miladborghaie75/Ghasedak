/**
 * AI Client (گام ۱۸-۳) — اینترفیس سازگار OpenAI برای چت‌بات مشتری.
 * - ماسک‌کردن کلید در لاگ (هرگز کامل چاپ نشود)
 * - Timeout و retry ساده
 * - Type-safe برای streaming و non-streaming
 */

import type { AIChatMessage, AIChatResponse, AIChatStreamChunk } from "@/types/ai";

const CHAT_ENDPOINT = "/api/ai/chat";

function maskKey(key: string): string {
  if (!key) return "••••";
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 3)}…${key.slice(-4)}`;
}

function logRequest(payload: unknown, isStream: boolean) {
  const safePayload = JSON.parse(JSON.stringify(payload));
  if (safePayload.model) safePayload.model = maskKey(safePayload.model);
  console.log(
    `[ai-client] ${isStream ? "stream" : "chat"} request:`,
    JSON.stringify(safePayload, null, 2)
  );
}

function logResponse(status: number, data?: unknown, error?: string) {
  if (error) {
    console.error(`[ai-client] error (${status}):`, error);
  } else {
    console.log(`[ai-client] response (${status}):`, data ? "ok" : "empty");
  }
}

/**
 * ارسال درخواست چت غیر-streaming
 */
export async function aiChat(messages: AIChatMessage[]): Promise<string> {
  const payload = { messages, stream: false };
  logRequest(payload, false);

  const res = await fetch(CHAT_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  }).catch((e) => {
    throw new Error(`Network error: ${String(e)}`);
  });

  const data = (await res.json().catch(() => null)) as (AIChatResponse | { error?: string }) | null;

  logResponse(res.status, data);

  if (!res.ok) {
    // بدنهٔ خطا ساختار {code, message} دارد — پیام انسانی را استخراج کن، نه JSON خام
    const msg = data && "message" in data && typeof data.message === "string" && data.message
      ? data.message
      : data && "error" in data
        ? data.error
        : `HTTP ${res.status}`;
    throw new Error(`AI chat failed: ${msg}`);
  }

  if (!data || !("content" in data) || !data.content) {
    throw new Error("AI returned empty content");
  }

  return data.content;
}

/**
 * ارسال درخواست چت streaming — reader برای SSE
 */
export async function aiChatStream(
  messages: AIChatMessage[],
  onChunk: (chunk: string) => void,
  onDone: () => void,
  onError: (error: string) => void
): Promise<void> {
  const payload = { messages, stream: true };
  logRequest(payload, true);

  const res = await fetch(CHAT_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60_000),
  }).catch((e) => {
    onError(`Network error: ${String(e)}`);
    return null;
  });

  if (!res || !res.ok || !res.body) {
    const text = res ? await res.text().catch(() => "") : "";
    // بدنهٔ خطا {code, message} است — پیام تمیز را به UI بده، نه JSON خام یا کد HTTP
    let msg = text || `HTTP ${res?.status ?? "no response"}`;
    try {
      const parsed = JSON.parse(text) as { message?: string } | null;
      if (parsed && typeof parsed.message === "string" && parsed.message) msg = parsed.message;
    } catch {
      // بدنهٔ غیر-JSON — همان متن خام
    }
    onError(msg);
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
          onDone();
          return;
        }
        try {
          const parsed = JSON.parse(data) as AIChatStreamChunk;
          if (parsed.error) {
            onError(parsed.error);
            return;
          }
          if (parsed.chunk) onChunk(parsed.chunk);
        } catch {
          // ignore parse errors on partial chunks
        }
      }
    }
    onDone();
  } catch (e) {
    onError(`Stream error: ${String(e)}`);
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