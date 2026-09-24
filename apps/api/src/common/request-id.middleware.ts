import { Injectable, NestMiddleware } from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";

/** درخواست حاوی شناسه یکتا — بدون augmentation، با intersection type */
export type RequestWithId = Request & { requestId?: string };

/** هر درخواست یک requestId یکتا می‌گیرد (بند ۸۸) */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const header = req.headers["x-request-id"];
    const id =
      typeof header === "string" && header.length > 0
        ? header
        : `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    (req as RequestWithId).requestId = id;
    res.setHeader("x-request-id", id);
    next();
  }
}
