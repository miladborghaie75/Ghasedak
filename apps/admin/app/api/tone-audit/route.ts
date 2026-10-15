import { NextResponse } from "next/server";
import { can } from "@/lib/session";
import { getIdentity } from "@/lib/session.server";
import { runToneAudit } from "@/lib/tone-audit";

export const dynamic = "force-dynamic";

/**
 * GET /api/tone-audit — گزارش ممیزی لحن هر دو اپ (ادمین + فروشگاه).
 * قاعده‌ها از هستهٔ مشترک می‌آیند؛ اینجا فقط نشست و مجوز بررسی می‌شود.
 */
export async function GET() {
  const me = await getIdentity();
  if (!me) {
    return NextResponse.json(
      { code: "UNAUTHENTICATED", message: "نشست پیدا نشد؛ دوباره وارد شو." },
      { status: 401 },
    );
  }
  if (!can(me.permissions, "settings.view")) {
    return NextResponse.json(
      { code: "FORBIDDEN", message: "دسترسی نداری؛ از مدیر ارشد مجوز «settings.view» بگیر." },
      { status: 403 },
    );
  }
  try {
    return NextResponse.json(runToneAudit());
  } catch (e) {
    return NextResponse.json(
      {
        code: "AUDIT_FAILED",
        message: `ممیزی اجرا نشد؛ سورس کامل برنامه روی این سرور حاضر نیست (${String(e)}) — روی سروری که سورس کامل دارد اجرایش کن.`,
      },
      { status: 500 },
    );
  }
}
