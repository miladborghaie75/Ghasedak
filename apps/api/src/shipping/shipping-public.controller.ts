import { Controller, Get } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/**
 * روش‌های ارسال عمومی — فاز ۱۴ موج ۱: storefront باید idهای واقعی DB را بفرستد
 * (CheckoutInput.shippingMethodId برابر id رکورد است؛ قبلاً «post»/«express» سخت‌کد
 * شده بود و سفارش 400 می‌خورد). فقط-خواندنی و بدون احراز هویت (گارد opt-in است):
 * هزینه و eta روش ارسال، اطلاعات عمومی مشتری است؛ فقط روش‌های active.
 */
@Controller("shipping")
export class ShippingPublicController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("methods")
  async list() {
    const methods = await this.prisma.shippingMethod.findMany({
      where: { status: "active" },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    return methods.map((m) => ({
      id: m.id,
      name: m.name,
      etaText: m.etaText,
      cost: Number(m.cost),
      freeOverAmount: m.freeOverAmount == null ? null : Number(m.freeOverAmount),
    }));
  }
}
