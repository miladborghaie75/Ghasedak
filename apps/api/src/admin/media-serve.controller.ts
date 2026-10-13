import { Controller, Get, Param, Res, NotFoundException } from "@nestjs/common";
import type { Response } from "express";
import * as fs from "fs";
import * as path from "path";
import { mediaDir, safeMediaPath } from "../common/media-dir";

/** سرو فایل Media — فقط داخل دایرکتوری امن؛ بدون path traversal (بند ۱۱۰) */

@Controller("media")
export class MediaServeController {
  @Get(":key")
  serve(@Param("key") key: string, @Res() res: Response) {
    // فقط نام فایل ساده — جلوگیری از path traversal
    if (!/^[a-zA-Z0-9._-]+$/.test(key) || key.includes("..")) {
      throw new NotFoundException();
    }
    const safe = safeMediaPath(key);
    if (!safe || !fs.existsSync(safe)) {
      throw new NotFoundException();
    }
    const ext = path.extname(key).toLowerCase();
    const mimes: Record<string, string> = {
      ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".pdf": "application/pdf",
    };
    res.setHeader("content-type", mimes[ext] ?? "application/octet-stream");
    res.setHeader("cache-control", "public, max-age=31536000, immutable");
    fs.createReadStream(safe).pipe(res);
  }
}
