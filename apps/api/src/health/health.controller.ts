import { Controller, Get, Req } from "@nestjs/common";
import type { Request } from "express";
import { HealthService } from "./health.service";
import type { HealthStatus } from "@ghasedak/contracts";
import type { RequestWithId } from "../common/request-id.middleware";

@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  async get(@Req() req: Request): Promise<HealthStatus> {
    const s = await this.health.getStatus();
    return { ...s, requestId: (req as RequestWithId).requestId ?? "" };
  }
}
