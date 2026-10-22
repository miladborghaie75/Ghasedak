import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export interface WishlistView {
  productIds: string[];
}

/**
 * علاقه‌مندی سروری (گام ۱۱ — بند ۴۲): مهمان بدون لاگین هم علاقه‌مندی دارد.
 * شناسایی با همان توکنِ کوکی سبد (x-cart-token که middleware فروشگاه می‌سازد)
 * به‌عنوان ownerKey ذخیره می‌شود — idempotent با @@unique([productId, ownerKey]).
 * محصول حذف‌شده/غیرمنتشر هرگز پذیرفته نمی‌شود؛ نمایش فقط id است (بدون PII).
 */
@Injectable()
export class WishlistService {
  constructor(private readonly prisma: PrismaService) {}

  private async view(ownerKey: string): Promise<WishlistView> {
    const rows = await this.prisma.wishlistItem.findMany({
      where: { ownerKey },
      orderBy: { createdAt: "desc" },
      select: { productId: true },
    });
    return { productIds: rows.map((r) => r.productId) };
  }

  async list(token: string): Promise<WishlistView> {
    if (!token) return { productIds: [] };
    return this.view(token);
  }

  async add(token: string, productId: string): Promise<WishlistView> {
    if (!token) {
      throw new BadRequestException({ code: "WISHLIST_NO_TOKEN", message: "توکن مهمان یافت نشد." });
    }
    if (typeof productId !== "string" || productId.length === 0) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "شناسهٔ محصول نامعتبر است." });
    }
    const product = await this.prisma.product.findFirst({
      where: { id: productId, status: "PUBLISHED", deletedAt: null },
      select: { id: true },
    });
    if (!product) {
      throw new BadRequestException({ code: "PRODUCT_NOT_FOUND", message: "محصول یافت نشد." });
    }
    await this.prisma.wishlistItem.upsert({
      where: { productId_ownerKey: { productId, ownerKey: token } },
      create: { productId, ownerKey: token },
      update: {},
    });
    return this.view(token);
  }

  async remove(token: string, productId: string): Promise<WishlistView> {
    if (!token) return { productIds: [] };
    await this.prisma.wishlistItem.deleteMany({ where: { productId, ownerKey: token } });
    return this.view(token);
  }
}
