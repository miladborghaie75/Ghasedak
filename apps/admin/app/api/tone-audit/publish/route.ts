import { NextResponse } from "next/server";
import { can } from "@/lib/session";
import { getIdentity } from "@/lib/session.server";
import { publishToneFix, TonePublishError } from "@/lib/tone-audit";

export const dynamic = "force-dynamic";

/**
 * POST /api/tone-audit/publish — انتشار یک اصلاح لحن در سورس.
 * مجوز «settings.manage» لازم دارد؛ جایگزینی امن را `applyReplacement`
 * انجام می‌دهد (یکتایی متن + ممنوعیت شکستن quote).
 */
export async function POST(req: Request) {
  const me = await getIdentity();
  if (!me) {
    return NextResponse.json(
      { code: "UNAUTHENTICATED", message: "نشست پیدا نشد؛ دوباره وارد شو." },
      { status: 401 },
    );
  }
  if (!can(me.permissions, "settings.manage")) {
    return NextResponse.json(
      { code: "FORBIDDEN", message: "انتشار فقط با مجوز «settings.manage»؛ از مدیر ارشد بگیر." },
      { status: 403 },
    );
  }
  const body = (await req.json().catch(() => null)) as {
    app?: string;
    file?: string;
    line?: number;
    text?: string;
    replacement?: string;
  } | null;
  if (!body?.text || !body.replacement || !body.app || !body.file) {
    return NextResponse.json(
      { code: "VALIDATION_ERROR", message: "فیلدهای app و file و text و replacement لازم است." },
      { status: 400 },
    );
  }
  if (body.text.length > 600 || body.replacement.length > 600) {
    return NextResponse.json(
      { code: "VALIDATION_ERROR", message: "متن بیش از حد بلند است؛ در سورس یک جمله اصلاح کن." },
      { status: 400 },
    );
  }
  try {
    const result = publishToneFix({
      app: body.app,
      file: body.file,
      line: typeof body.line === "number" ? body.line : undefined,
      text: body.text,
      replacement: body.replacement,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof TonePublishError) {
      return NextResponse.json({ code: e.code, message: e.message }, { status: 422 });
    }
    return NextResponse.json(
      { code: "PUBLISH_FAILED", message: `انتشار انجام نشد (${String(e)})؛ فایل را بررسی کن و دوباره تلاش کن.` },
      { status: 500 },
    );
  }
}
