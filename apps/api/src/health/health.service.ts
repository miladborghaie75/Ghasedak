import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/**
 * سلامت اجزا (بند ۸۸) — db واقعی؛ redis/storage در فازهای بعدی real می‌شوند.
 */
@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}
  async getStatus(): Promise<{
    status: "ok" | "degraded";
    checks: { api: boolean; db: boolean; redis: boolean; storage: boolean };
    uptimeSeconds: number;
  }> {
    let db = false;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      db = true;
    } catch {
      db = false;
    }
    const redis = false; // Phase 17+: ping
    const storage = false; // Phase 6: storage abstraction head request

    const allOk = db && redis && storage;
    return {
      status: allOk ? "ok" : "degraded",
      checks: { api: true, db, redis, storage },
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }
}
