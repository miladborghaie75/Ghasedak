import { Controller, Get } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/**
 * دادهٔ جغرافیایی عمومی — منبع حقیقت: دیتابیس (Province/City).
 * بدون احراز هویت؛ فرم checkout فروشگاه استان/شهر را از همین میخواند.
 */
@Controller("geo")
export class GeoController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("provinces")
  async provinces() {
    const provinces = await this.prisma.province.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        cities: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } },
      },
    });
    return { items: provinces };
  }
}
