import type { NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

type JsonFn = (this: Response, body: unknown, ...rest: unknown[]) => Response;

/** BigInt → string قبل از JSON.stringify — یک‌جا در سطح پاسخ (بند ۹۷: Money صحیح) */
export class BigIntJsonMiddleware implements NestMiddleware {
  use(_req: Request, res: Response, next: NextFunction): void {
    const proto = res as unknown as { __ghasedakBigIntPatched?: boolean; json: JsonFn };
    if (!proto.__ghasedakBigIntPatched) {
      proto.__ghasedakBigIntPatched = true;
      const originalJson = proto.json.bind(res);
      proto.json = function (body: unknown, ...rest: unknown[]) {
        return originalJson(serialize(body), ...rest);
      };
    }
    next();
  }
}

export function serialize(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === "object" && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = serialize(v);
    return out;
  }
  return value;
}
