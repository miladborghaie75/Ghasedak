import { Body, Controller, Post, Req, Res } from "@nestjs/common";
import type { Request, Response as ExpressResponse } from "express";
import { CustomerChatService } from "./customer-chat.service";

@Controller("customer-chat")
export class CustomerChatController {
  constructor(private readonly chat: CustomerChatService) {}

  @Post()
  async respond(@Body() body: unknown, @Req() req: Request, @Res() res: ExpressResponse): Promise<void> {
    // کلید سقفِ روزانهٔ هر کاربر — پشت پروکسی، اولین IP واقعی از x-forwarded-for.
    const forwarded = req.headers["x-forwarded-for"];
    const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
    await this.chat.respond(body, res, ip || req.ip || "anon");
  }
}
