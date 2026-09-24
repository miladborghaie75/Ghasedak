import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { ProductsService, type ListQuery } from "./products.service";
import { PermissionsGuard, RequirePermission } from "../auth/permissions.guard";

@Controller("admin/products")
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @RequirePermission("products.view")
  list(@Query() query: ListQuery) {
    return this.products.list(query);
  }

  @Post()
  @RequirePermission("products.create")
  create(@Body() body: Parameters<ProductsService["create"]>[0]) {
    return this.products.create(body);
  }

  /** ایجاد کامل با واریانت/SEO/ویژگی‌ها (بند ۱۰) */
  @Post("full")
  @RequirePermission("products.create")
  createFull(@Body() body: Parameters<ProductsService["createFull"]>[0]) {
    return this.products.createFull(body);
  }

  /** جزئیات کامل برای فرم ویرایش */
  @Get(":id/detail")
  @RequirePermission("products.view")
  detail(@Param("id") id: string) {
    return this.products.detail(id);
  }

  /** ویرایش کامل — فیلدها + واریانت‌ها (تغییر بارکد مجاز) + عکس‌ها */
  @Put(":id/full")
  @RequirePermission("products.update")
  updateFull(@Param("id") id: string, @Body() body: Parameters<ProductsService["updateFull"]>[1]) {
    return this.products.updateFull(id, body);
  }

  /** ماتریس واریانت سایز×رنگ — SKU/بارکد خودکار پیشنهاد می‌شود */
  @Post(":id/variant-matrix")
  @RequirePermission("products.update")
  variantMatrix(@Param("id") id: string, @Body() body: { sizeTermIds: string[]; colorTermIds?: string[] }) {
    return this.products.variantMatrix(id, body);
  }

  /** پیشنهاد SEO قاعده‌محور — بدون جعل */
  @Get(":id/seo-suggest")
  @RequirePermission("products.view")
  suggestSeo(@Param("id") id: string) {
    return this.products.suggestSeo(id);
  }

  /** جستجوی سریع بارکد/SKU برای POS و فرم‌ها */
  @Get("lookup")
  @RequirePermission("products.view")
  async lookup(@Query("code") code: string) {
    return this.products.lookupByCode(code);
  }

  /** جستجوی زنده محصولات برای POS — نام/برند/SKU/بارکد با نرمال‌سازی فارسی */
  @Get("pos-search")
  @RequirePermission("pos.sell")
  async posSearch(@Query("q") q: string) {
    return this.products.posSearch(q ?? "");
  }

  @Patch(":id")
  @RequirePermission("products.update")
  update(@Param("id") id: string, @Body() body: Parameters<ProductsService["update"]>[1]) {
    return this.products.update(id, body);
  }

  @Delete(":id")
  @RequirePermission("products.delete")
  async remove(@Param("id") id: string): Promise<{ ok: true }> {
    await this.products.softDelete(id);
    return { ok: true };
  }
}

void PermissionsGuard; // Guard به‌صورت global در AppModule ثبت می‌شود
