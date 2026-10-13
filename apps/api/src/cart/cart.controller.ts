import { Body, Controller, Delete, Get, Headers, Param, Post } from "@nestjs/common";
import { CartService } from "./cart.service";

/**
 * سبد سروری — عمومی (مهمان هم سبد دارد). شناسایی با هدر x-cart-token که
 * middleware فروشگاه از کوکی می‌خواند و می‌فرستد. قیمت هنگام checkout بازمحاسبه می‌شود.
 */
@Controller("cart")
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  get(@Headers("x-cart-token") token?: string) {
    return this.cart.get(token ?? "");
  }

  @Post("items")
  upsert(
    @Headers("x-cart-token") token: string | undefined,
    @Body() body: { variantId?: string; qty?: number },
  ) {
    return this.cart.upsert(token ?? "", String(body?.variantId ?? ""), Number(body?.qty ?? 0));
  }

  @Delete("items/:variantId")
  remove(@Headers("x-cart-token") token: string | undefined, @Param("variantId") variantId: string) {
    return this.cart.remove(token ?? "", variantId);
  }

  @Delete()
  clear(@Headers("x-cart-token") token?: string) {
    return this.cart.clear(token ?? "");
  }
}
