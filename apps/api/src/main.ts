import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./common/http-exception.filter";
import { PrismaService } from "./prisma/prisma.service";
import { resolvePort, dbUnreachableMessage } from "./common/boot-config";
import helmet from "helmet";

/**
 * Ghasedak API — نقطه ورود.
 * همه پاسخ‌های خطا با فرمت استاندارد بند ۶۵ برگردانده می‌شوند
 * و هر درخواست requestId دارد (بند ۸۸).
 */
/** فاز پس از ۱۲ — .env.local (نوشتهٔ پنل ادمین) قبل از بوت لود می‌شود؛ env سیستم همیشه اولویت دارد */
function loadEnvLocal(): void {
  const p = resolve(__dirname, "../.env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

/** خطای مرتبط با اتصال DB (Prisma P10xx یا ECONNREFUSED) — برای پیام روشن بوت */
function isDbConnectionError(e: unknown): boolean {
  const code = (e as { code?: string })?.code ?? "";
  if (/^P1[0-9]{3}$/.test(code)) return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /can't reach database server|ECONNREFUSED|connection (refused|closed)|P1001/i.test(msg);
}

async function bootstrap(): Promise<void> {
  loadEnvLocal();

  // گام F0-4 — گارد بوت: API بدون دیتابیس بالا نمی‌آید.
  // پیش‌تر خطای خام Prisma در لاگ می‌افتاد و اپراتور باید حدس می‌زد؛ حالا
  // پیام فارسی با هدف اتصال (بدون رمز) و پورت‌های کانونیکال چاپ می‌شود.
  let app: NestExpressApplication;
  try {
    app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ["error", "warn", "log"] });
  } catch (e) {
    if (isDbConnectionError(e)) {
      console.error(dbUnreachableMessage(process.env.DATABASE_URL, e));
    } else {
      console.error(`[ghasedak-api] بوت اپلیکیشن شکست خورد: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    }
    process.exit(1);
  }

  try {
    // PrismaService در onModuleInit وصل می‌شود؛ این SELECT یک تأیید صریح روی همان
    // اتصال است تا «هستهٔ سالم ولی DB قطع» به‌جای نصفه-بالا، صریح fail شود.
    await app.get(PrismaService).$queryRaw`SELECT 1`;
  } catch (e) {
    console.error(dbUnreachableMessage(process.env.DATABASE_URL, e));
    await app.close().catch(() => undefined);
    process.exit(1);
  }

  app.setGlobalPrefix("api/v1");
  app.enableCors({ origin: corsOrigins(), credentials: true });
  app.use(helmet({ contentSecurityPolicy: false }));
  app.useGlobalFilters(new HttpExceptionFilter());
  // آپلود رسانه base64 در JSON — سقف ~15MB بدنه (فایل ≤10MB بعد از انکودینگ)؛ بند ۳۵
  app.useBodyParser("json", { limit: "15mb" });

  const { port, warning } = resolvePort(process.env.PORT);
  if (warning) console.warn(`[ghasedak-api] ${warning}`);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`[ghasedak-api] listening on :${port}`);
}

function corsOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS ?? "http://localhost:3000";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

void bootstrap();
