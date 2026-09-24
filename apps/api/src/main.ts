import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./common/http-exception.filter";
import helmet from "helmet";

/**
 * Ghasedak API — نقطه ورود.
 * همه پاسخ‌های خطا با فرمت استاندارد بند ۶۵ برگردانده می‌شوند
 * و هر درخواست requestId دارد (بند ۸۸).
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: ["error", "warn", "log"] });

  app.setGlobalPrefix("api/v1");
  app.enableCors({ origin: corsOrigins(), credentials: true });
  app.use(helmet({ contentSecurityPolicy: false }));
  app.useGlobalFilters(new HttpExceptionFilter());

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
