import "reflect-metadata";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { PermissionsGuard, RequirePermission } from "../src/auth/permissions.guard";

/** بند ۹۴: مجوز سمت سرور — Cashier نباید به حسابداری برسد */
describe("PermissionsGuard", () => {
  function makeContext(identity: unknown, handlerPermission?: string[], classPermission?: string[]) {
    // SetMetadata روی descriptor می‌نشیند — همان ساختاری که NestJS واقعی می‌سازد
    const target = { method() { return null; } };
    const descriptor = Object.getOwnPropertyDescriptor(target, "method")!;
    if (handlerPermission) {
      Reflect.apply(RequirePermission(...handlerPermission), null, [target, "method", descriptor]);
    }
    const handler = descriptor.value ?? (() => null);
    const cls = class ControllerUnderTest {};
    if (classPermission) {
      // متادیتای کلاس (دکوراتور روی @Controller) — باید مثل هندلر معتبر باشد
      Reflect.apply(RequirePermission(...classPermission), null, [cls]);
    }
    return {
      switchToHttp: () => ({
        getRequest: () => ({ adminIdentity: identity }),
      }),
      getHandler: () => handler,
      getClass: () => cls,
    } as never;
  }

  // getAllAndOverride واقعی NestJS: اولین متادیتای موجود از [handler, class] را برمی‌گرداند
  const reflector = {
    get: (_k: string, fn: unknown) => Reflect.getMetadata("ghasedak:permission", fn as object),
    getAllAndOverride: (_k: string, targets: unknown[]) => {
      for (const t of targets) {
        const v = Reflect.getMetadata("ghasedak:permission", t as object);
        if (v !== undefined) return v;
      }
      return undefined;
    },
  };
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

  it("مجوز سطح کلاس هم اعمال می‌شود (بدون identity → 401)", () => {
    const ctx = makeContext(null, undefined, ["reviews.moderate"]);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it("مجوز سطح کلاس + identity بی‌مجوز → 403", () => {
    const cashier = { permissions: ["pos.sell"] };
    const ctx = makeContext(cashier, undefined, ["reviews.moderate"]);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it("مجوز هندلر بر مجوز کلاس اولویت دارد", () => {
    const manager = { permissions: ["products.view"] };
    // کلاس reviews.moderate می‌خواهد، هندلر فقط products.view → همان هندلر معیار است
    const ctx = makeContext(manager, ["products.view"], ["reviews.moderate"]);
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
