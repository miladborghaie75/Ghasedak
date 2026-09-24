import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { AuthService } from "./auth.service";

@Injectable()
export class SessionMiddleware implements NestMiddleware {
  constructor(private readonly auth: AuthService) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    (req as unknown as Record<string, unknown>).adminIdentity = await this.auth.identity(req);
    next();
  }
}
