import "reflect-metadata";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { PermissionsGuard, RequirePermission } from "../src/auth/permissions.guard";

/** بند ۹۴: مجوز سمت سرور — Cashier نباید به حسابداری برسد */
describe("PermissionsGuard", () => {
  function makeContext(identity: unknown, handlerPermission?: string[]) {
    // SetMetadata روی descriptor می‌نشیند — همان ساختاری که NestJS واقعی می‌سازد
    const target = { method() { return null; } };
    const descriptor = Object.getOwnPropertyDescriptor(target, "method")!;
    if (handlerPermission) {
      Reflect.apply(RequirePermission(...handlerPermission), null, [target, "method", descriptor]);
    }
    const handler = descriptor.value ?? (() => null);
    return {
      switchToHttp: () => ({
        getRequest: () => ({ adminIdentity: identity }),
      }),
      getHandler: () => handler,
      getClass: () => target,
    } as never;
  }

  const reflector = { get: (_k: string, fn: unknown) => Reflect.getMetadata("ghasedak:permission", fn as object) };
  const guard = new PermissionsGuard(reflector as never);

  it("بدون identity → 401", () => {
    const ctx = makeContext(null, ["products.view"]);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it("cashier بدون مجوز حسابداری → 403", () => {
    const cashier = { permissions: ["pos.sell", "products.view"] };
    const ctx = makeContext(cashier, ["accounting.journal"]);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it("admin با مجوز → عبور", () => {
    const admin = { permissions: ["accounting.journal", "products.view"] };
    const ctx = makeContext(admin, ["accounting.journal"]);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it("مسیر بدون decorator → باز", () => {
    const ctx = makeContext(null);
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
