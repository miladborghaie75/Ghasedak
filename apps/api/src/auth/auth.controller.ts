import { Body, Controller, Get, HttpCode, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { AuthService, SESSION_COOKIE } from "./auth.service";
import { Identity } from "./identity.decorator";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("login")
  @HttpCode(200)
  async login(
    @Body() body: { email?: string; password?: string },
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: { name: string | null; email: string | null; role: string } }> {
    if (!body.email || !body.password) {
      throw new (await import("@nestjs/common")).BadRequestException({
        code: "VALIDATION_ERROR",
        fieldErrors: { email: body.email ? [] : ["ایمیل الزامی است"], password: body.password ? [] : ["رمز الزامی است"] },
      });
    }
    const { token, expiresAt } = await this.auth.login(body.email, body.password);
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      expires: expiresAt,
      path: "/",
    });
    const identity = await this.auth.identity({ headers: { cookie: `${SESSION_COOKIE}=${token}` } } as Request);
    return {
      user: { name: identity?.name ?? null, email: identity?.email ?? null, role: identity?.role ?? "" },
    };
  }

  @Post("logout")
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(req);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
  }

  @Get("me")
  async me(@Identity() identity: unknown): Promise<unknown> {
    return identity ?? null;
  }
}
