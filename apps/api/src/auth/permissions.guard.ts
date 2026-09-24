import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { AdminIdentity } from "./auth.service";

export const PERMISSION_KEY = "ghasedak:permission";

/** decorator: @RequirePermission("products.view") */
export function RequirePermission(...permissions: string[]) {
  return SetMetadata(PERMISSION_KEY, permissions);
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.get<string[]>(PERMISSION_KEY, context.getHandler());
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<Record<string, unknown>>();
    const identity = req.adminIdentity as AdminIdentity | null | undefined;
    if (!identity) {
      throw new UnauthorizedException({ code: "UNAUTHORIZED", message: "ورود لازم است." });
    }
    const ok = required.every((p) => identity.permissions.includes(p));
    if (!ok) {
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "دسترسی لازم را ندارید.",
      });
    }
    return true;
  }
}
