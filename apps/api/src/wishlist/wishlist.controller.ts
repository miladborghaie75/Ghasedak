import { Body, Controller, Delete, Get, Headers, Param, Post } from "@nestjs/common";
import { WishlistService } from "./wishlist.service";

/**
 * علاقه‌مندی سروری — عمومی (مهمان؛ بند ۴۲). همان الگوی cart:
 * شناسایی با هدر x-cart-token که middleware فروشگاه از کوکی cart_token
 * (httpOnly، ۳۰ روز) می‌خواند و می‌فرستد. هیچ PII ذخیره نمی‌شود.
 */
@Controller("wishlist")
export class WishlistController {
  constructor(private readonly wishlist: WishlistService) {}

  @Get()
  list(@Headers("x-cart-token") token?: string) {
    return this.wishlist.list(token ?? "");
  }

  @Post("items")
  add(
    @Headers("x-cart-token") token: string | undefined,
    @Body() body: { productId?: string },
  ) {
    return this.wishlist.add(token ?? "", String(body?.productId ?? ""));
  }

  @Delete("items/:productId")
  remove(
    @Headers("x-cart-token") token: string | undefined,
    @Param("productId") productId: string,
  ) {
    return this.wishlist.remove(token ?? "", productId);
  }
}
