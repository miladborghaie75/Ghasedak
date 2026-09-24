import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { AdminIdentity } from "./auth.service";

export const Identity = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AdminIdentity | null => {
    const req = ctx.switchToHttp().getRequest() as unknown as Record<string, unknown>;
    const value = req.adminIdentity as AdminIdentity | null | undefined;
    return value ?? null;
  },
);
