/**
 * Public AI Chat endpoint (گام ۱۸-۳) — پراکسی امن برای چت‌بات مشتری
 * - SSE streaming و non-streaming
 * - اعتبارسنجی ورودی (messages، length، role)
 * - Rate limit در حافظه (تک‌نود V1؛ production چندنودی → Redis)
 * - Forward عمومی به endpoint مستقل مشتری، بدون ارسال کوکی یا کلید مدیریتی
 */
import { NextRequest, NextResponse } from "next/server";

/**
 * In-memory rate limiter for public AI chat endpoint
 * Rule: 20 requests per minute per IP
 */
const CHAT_BUCKETS = new Map<string, { count: number; resetAt: number }>();
const CHAT_RATE_LIMIT = { max: 20, windowMs: 60_000 };

function checkRateLimit(ip: string): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const bucket = CHAT_BUCKETS.get(ip);
  if (!bucket || bucket.resetAt < now) {
    const resetAt = now + CHAT_RATE_LIMIT.windowMs;
    CHAT_BUCKETS.set(ip, { count: 1, resetAt });
    return { allowed: true, remaining: CHAT_RATE_LIMIT.max - 1, resetAt };
  }
  bucket.count += 1;
  if (bucket.count > CHAT_RATE_LIMIT.max) {
    return { allowed: false, remaining: 0, resetAt: bucket.resetAt };
  }
  return { allowed: true, remaining: CHAT_RATE_LIMIT.max - bucket.count, resetAt: bucket.resetAt };
}

// Periodic cleanup
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of CHAT_BUCKETS) if (v.resetAt < now) CHAT_BUCKETS.delete(k);
}, 300_000).unref();

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const API = process.env.API_ORIGIN ?? "http://localhost:4000";
const CHAT_ENDPOINT = `${API}/api/v1/customer-chat`;

interface AIChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface AIChatRequest {
  messages: AIChatMessage[];
  stream?: boolean;
}

function validateMessages(messages: unknown): messages is AIChatMessage[] {
  if (!Array.isArray(messages)) return false;
  if (messages.length === 0) return false;
  if (messages.length > 10) return false; // limit history

  return    messages.every(
      (m) =>
        typeof m === "object" &&
        m !== null &&
        "role" in m &&
        "content" in m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim().length > 0 &&
        m.content.length <= 2000
    ) && messages.some((m) => m.role === "user");
}

async function forwardToApi(body: AIChatRequest): Promise<Response> {
  return fetch(CHAT_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(body.stream ? 60_000 : 30_000),
  });
}

export async function POST(req: NextRequest) {
  // Rate limit check
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const rateLimit = checkRateLimit(ip);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { code: "RATE_LIMITED", message: "بیش از حد درخواست دادی؛ یک دقیقه صبر کن و دوباره تلاش کن." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rateLimit.resetAt - Date.now()) / 1000)) } }
    );
  }

  let body: AIChatRequest;

  try {      body = await req.json();
  } catch {
    return NextResponse.json(
      { code: "VALIDATION_ERROR", message: "بدنه درخواست نامعتبر است" },
      { status: 400, headers: { "X-RateLimit-Limit": String(CHAT_RATE_LIMIT.max), "X-RateLimit-Remaining": String(rateLimit.remaining), "X-RateLimit-Reset": String(Math.ceil(rateLimit.resetAt / 1000)) } }
    );
  }

  // Validation
  if (!body || typeof body !== "object" || !validateMessages(body.messages)) {
    return NextResponse.json(
      {
        code: "VALIDATION_ERROR",
        message: "پیام‌ها نامعتبرند؛ تاریخچه را کوتاه‌تر بفرست و بررسی کن.",
      },
      { status: 400, headers: { "X-RateLimit-Limit": String(CHAT_RATE_LIMIT.max), "X-RateLimit-Remaining": String(rateLimit.remaining), "X-RateLimit-Reset": String(Math.ceil(rateLimit.resetAt / 1000)) } }
    );
  }

  const isStream = body.stream === true;

  try {
    const upstream = await forwardToApi(body);

    if (!upstream.ok) {
      const errorData = await upstream.json().catch(() => ({}));
      // جزئیات provider را به مشتری بازتاب نده؛ فقط پیام‌های محلی و کدهای شناخته‌شده مجازند.
      const message = upstream.status === 429
        ? "بیش از حد درخواست دادی؛ یک دقیقه صبر کن و دوباره تلاش کن."
        : errorData?.code === "VALIDATION_ERROR"
          ? "پیام‌ها نامعتبرند؛ تاریخچه را بررسی کن و دوباره بفرست."
          : "پاسخ دستیار موقتاً در دسترس نیست؛ کمی بعد دوباره تلاش کن.";

      const errorHeaders = {
        "X-RateLimit-Limit": String(CHAT_RATE_LIMIT.max),
        "X-RateLimit-Remaining": String(rateLimit.remaining),
        "X-RateLimit-Reset": String(Math.ceil(rateLimit.resetAt / 1000)),
      };

      // Map specific error codes
      if (upstream.status === 429) {
        return NextResponse.json(
          { code: "RATE_LIMITED", message },
          { status: 429, headers: errorHeaders }
        );
      }
      if (upstream.status === 401 || upstream.status === 403 || errorData?.code === "REQUIRES_CREDENTIAL") {
        // AI_BASE_URL/AI_API_KEY/AI_MODEL هنوز کامل ست نشده‌اند — پیام مدیرپسند بالادست هرگز
        // به مشتری نمی‌رسد؛ فقط همین پیام صادقانه و مشتری‌پسند (بند ۱۱۱: هیچ پاسخ جعلی ساخته نمی‌شود)
        return NextResponse.json(
          { code: "REQUIRES_CREDENTIAL", message: "پاسخ دستیار موقتاً در دسترس نیست؛ کمی بعد دوباره تلاش کن." },
          { status: 503, headers: errorHeaders }
        );
      }

      return NextResponse.json(
        { code: errorData?.code === "VALIDATION_ERROR" ? "VALIDATION_ERROR" : "UPSTREAM_ERROR", message },
        { status: errorData?.code === "VALIDATION_ERROR" ? 400 : 502, headers: errorHeaders }
      );
    }

    const rateLimitHeaders = {
      "X-RateLimit-Limit": String(CHAT_RATE_LIMIT.max),
      "X-RateLimit-Remaining": String(rateLimit.remaining),
      "X-RateLimit-Reset": String(Math.ceil(rateLimit.resetAt / 1000)),
    };

    if (isStream) {
      // Return SSE stream directly
      if (!upstream.body) {
        return NextResponse.json(
          { code: "UPSTREAM_ERROR", message: "بدون بدنه پاسخ" },
          { status: 502, headers: rateLimitHeaders }
        );
      }

      return new Response(upstream.body, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          ...rateLimitHeaders,
        },
      });
    }

    // Non-streaming: return JSON
    const data = await upstream.json();
    return NextResponse.json(data, { headers: rateLimitHeaders });
  } catch (error) {
    console.error("[api/ai/chat] request failed:", error instanceof Error ? error.name : "unknown");

    const errorHeaders = {
      "X-RateLimit-Limit": String(CHAT_RATE_LIMIT.max),
      "X-RateLimit-Remaining": String(rateLimit.remaining),
      "X-RateLimit-Reset": String(Math.ceil(rateLimit.resetAt / 1000)),
    };

    if (error instanceof Error && error.name === "TimeoutError") {
      return NextResponse.json(
        { code: "TIMEOUT", message: "پاسخ دستیار موقتاً در دسترس نیست؛ دوباره تلاش کن." },
        { status: 504, headers: errorHeaders }
      );
    }

    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "خطای داخلی سرور" },
      { status: 500, headers: errorHeaders }
    );
  }
}