import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export interface CartLineDto {
  variantId: string;
  qty: number;
}
export interface CartView {
  lines: CartLineDto[];
  count: number;
}

/**
 * سبد سروری (فاز ۱ — گام ۶). منبع حقیقت سرور است؛ کلاینت فقط نمایش می‌دهد.
 * شناسایی سبد با توکنِ کوکی (که middleware فروشگاه می‌سازد و در هدر x-cart-token می‌آید).
 * قیمت/موجودی هنگام checkout دوباره سمت سرور محاسبه می‌شود؛ اینجا فقط تعداد نگه داشته می‌شود.
 */
@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  private async getCartId(token: string): Promise<string | null> {
    const c = await this.prisma.cart.findUnique({ where: { token }, select: { id: true } });
    return c?.id ?? null;
  }

  private async getOrCreateCartId(token: string): Promise<string> {
    const existing = await this.prisma.cart.findUnique({ where: { token }, select: { id: true } });
    if (existing) return existing.id;
    const created = await this.prisma.cart.create({ data: { token, status: "active" }, select: { id: true } });
    return created.id;
  }

  private async view(cartId: string): Promise<CartView> {
    const items = await this.prisma.cartItem.findMany({
      where: { cartId, qty: { gt: 0 } },
      orderBy: { createdAt: "asc" },
      select: { variant: { select: { sku: true } }, qty: true },
    });
    // کلاینت «variantId» را با SKU کار می‌کند (همان قرارداد checkout)
    return { lines: items.map((i) => ({ variantId: i.variant.sku, qty: i.qty })), count: items.reduce((s, l) => s + l.qty, 0) };
  }

  async get(token: string): Promise<CartView> {
    if (!token) return { lines: [], count: 0 };
    const id = await this.getCartId(token);
    if (!id) return { lines: [], count: 0 };
    return this.view(id);
  }

  async upsert(token: string, variantId: string, qty: number): Promise<CartView> {
    if (!token) throw new BadRequestException({ code: "CART_NO_TOKEN", message: "توکن سبد یافت نشد." });
    if (typeof variantId !== "string" || variantId.length === 0) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "شناسهٔ کالا نامعتبر است." });
    }
    if (!Number.isSafeInteger(qty) || qty < 0 || qty > 99) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "تعداد نامعتبر است." });
    }
    // ورودی کلاینت SKU است — به variant داخلی resolve می‌کنیم (id در CartItem ذخیره می‌شود)
    const variant = await this.prisma.productVariant.findFirst({
      where: { OR: [{ sku: variantId }, { id: variantId }] },
      select: { id: true, sku: true, price: true, salePrice: true, status: true, deletedAt: true },
    });
    if (!variant || variant.deletedAt || variant.status !== "PUBLISHED") {
      throw new BadRequestException({ code: "VARIANT_NOT_FOUND", message: "کالا یافت نشد." });
    }
    const cartId = await this.getOrCreateCartId(token);
    if (qty <= 0) {
      await this.prisma.cartItem.deleteMany({ where: { cartId, variantId: variant.id } });
    } else {
      const unit = variant.salePrice ?? variant.price;
      await this.prisma.cartItem.upsert({
        where: { cartId_variantId: { cartId, variantId: variant.id } },
        create: { cartId, variantId: variant.id, qty, unitPriceSnapshot: unit },
        update: { qty, unitPriceSnapshot: unit },
      });
    }
    return this.view(cartId);
  }

  async remove(token: string, sku: string): Promise<CartView> {
    if (!token) return { lines: [], count: 0 };
    const id = await this.getCartId(token);
    if (!id) return { lines: [], count: 0 };
    // SKU یا id — هر دو پذیرفته می‌شود
    await this.prisma.cartItem.deleteMany({
      where: { cartId: id, variant: { OR: [{ sku }, { id: sku }] } },
    });
    return this.view(id);
  }

  async clear(token: string): Promise<CartView> {
    if (!token) return { lines: [], count: 0 };
    const id = await this.getCartId(token);
    if (!id) return { lines: [], count: 0 };
    await this.prisma.cartItem.deleteMany({ where: { cartId: id } });
    return { lines: [], count: 0 };
  }
}
