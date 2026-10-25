/**
 * Public AI Chat endpoint (گام ۱۸-۳) — پراکسی امن برای چت‌بات مشتری
 * - SSE streaming و non-streaming
 * - اعتبارسنجی ورودی (messages، length، role)
 * - Rate limit در حافظه (تک‌نود V1؛ production چندنودی → Redis)
 * - Forward به endpoint داخلی ادمین با credential
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
const CHAT_ENDPOINT = `${API}/api/v1/admin/capabilities/ai/chat`;
/**
 * کلید سرویس‌توسرور (GHASEDAK_API_KEY) — فقط سمت سرور؛ SessionMiddleware آن را
 * به هویت سیم‌ابر (SUPERADMIN) تبدیل می‌کند تا چت مشتریِ واردنشده هم کار کند.
 * هرگز NEXT_PUBLIC نمی‌شود و در پاسخ/لاگ دیده نمی‌شود.
 */
const SERVICE_KEY = process.env.GHASEDAK_API_KEY ?? "";

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

  return messages.every(
    (m) =>
      typeof m === "object" &&
      m !== null &&
      "role" in m &&
      "content" in m &&
      (m.role === "user" || m.role === "assistant") &&
      typeof m.content === "string" &&
      m.content.length > 0 &&
      m.content.length <= 2000
  );
}

async function forwardToApi(
  body: AIChatRequest,
  req: NextRequest
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    // Forward cookies for auth if needed (admin endpoint may require session)
    cookie: req.headers.get("cookie") ?? "",
  };
  // کلید سرویس فقط وقتی ارسال می‌شود که سشن ادمین موجود نباشد (داخل SessionMiddleware اولویت با سشن است)
  if (SERVICE_KEY) headers["x-api-key"] = SERVICE_KEY;

  const response = await fetch(CHAT_ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(body.stream ? 60_000 : 30_000),
  });

  return response;
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

  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { code: "VALIDATION_ERROR", message: "بدنه درخواست نامعتبر است" },
      { status: 400, headers: { "X-RateLimit-Limit": String(CHAT_RATE_LIMIT.max), "X-RateLimit-Remaining": String(rateLimit.remaining), "X-RateLimit-Reset": String(Math.ceil(rateLimit.resetAt / 1000)) } }
    );
  }

  // Validation
  if (!validateMessages(body.messages)) {
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
    const upstream = await forwardToApi(body, req);

    if (!upstream.ok) {
      const errorData = await upstream.json().catch(() => ({}));
      const message =
        errorData?.message ??
        errorData?.error ??
        `خطای سرور: ${upstream.status}`;

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
      if (upstream.status === 401 || upstream.status === 403) {
        // 401 بالادست یعنی کلید سرویس (GHASEDAK_API_KEY) ست نیست/نادرست است — نه کلید ارائه‌دهندهٔ AI
        return NextResponse.json(
          { code: "REQUIRES_CREDENTIAL", message: "چت موقتاً در دسترس نیست؛ کمی بعد دوباره تلاش کن." },
          { status: 503, headers: errorHeaders }
        );
      }
      if (errorData?.code === "REQUIRES_CREDENTIAL") {
        // AI_BASE_URL/AI_API_KEY/AI_MODEL هنوز کامل ست نشده‌اند — پیام مدیرپسند بالادست هرگز
        // به مشتری نمی‌رسد؛ فقط همین پیام صادقانه و مشتری‌پسند (بند ۱۱۱: هیچ پاسخ جعلی ساخته نمی‌شود)
        return NextResponse.json(
          { code: "REQUIRES_CREDENTIAL", message: "چت موقتاً در دسترس نیست؛ کمی بعد دوباره تلاش کن." },
          { status: 503, headers: errorHeaders }
        );
      }

      return NextResponse.json(
        { code: "UPSTREAM_ERROR", message },
        { status: 502, headers: errorHeaders }
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
    console.error("[api/ai/chat] error:", error instanceof Error ? error.message : String(error));

    const errorHeaders = {
      "X-RateLimit-Limit": String(CHAT_RATE_LIMIT.max),
      "X-RateLimit-Remaining": String(rateLimit.remaining),
      "X-RateLimit-Reset": String(Math.ceil(rateLimit.resetAt / 1000)),
    };

    if (error instanceof Error && error.name === "TimeoutError") {
      return NextResponse.json(
        { code: "TIMEOUT", message: "زمان پاسخ سرور به پایان رسید" },
        { status: 504, headers: errorHeaders }
      );
    }

    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "خطای داخلی سرور" },
      { status: 500, headers: errorHeaders }
    );
  }
}