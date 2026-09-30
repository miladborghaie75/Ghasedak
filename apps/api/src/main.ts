import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./common/http-exception.filter";
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

async function bootstrap(): Promise<void> {
  loadEnvLocal();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ["error", "warn", "log"] });

  app.setGlobalPrefix("api/v1");
  app.enableCors({ origin: corsOrigins(), credentials: true });
  app.use(helmet({ contentSecurityPolicy: false }));
  app.useGlobalFilters(new HttpExceptionFilter());
  // آپلود رسانه base64 در JSON — سقف ~15MB بدنه (فایل ≤10MB بعد از انکودینگ)؛ بند ۳۵
  app.useBodyParser("json", { limit: "15mb" });

  const rawPort = process.env.PORT;
  const port = rawPort && Number(rawPort) > 0 ? Number(rawPort) : 4000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`[ghasedak-api] listening on :${port}`);
}

function corsOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS ?? "http://localhost:3000";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

void bootstrap();
