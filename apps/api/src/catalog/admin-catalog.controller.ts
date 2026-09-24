import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RequirePermission } from "../auth/permissions.guard";
import { randomUUID } from "crypto";

function slugify(input: string): string {
  return (
    input
      .trim()
      .toLowerCase()
      .replace(/[\s\u200c]+/g, "-")
      .replace(/[^a-z0-9\u0600-\u06FF-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || `item-${randomUUID().slice(0, 8)}`
  );
}

/**
 * API کاتالوگ ادمین — دسته‌های درختی تا ۵ سطح، برند، ویژگی و مقادیر آن.
 * همه مجوزها سمت سرور چک می‌شود (بند ۷).
 */
@Controller("admin/catalog")
export class AdminCatalogController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  // ---------- دسته‌ها (درخت تا عمق ۵) ----------
  @Get("categories")
  @RequirePermission("categories.view")
  async categories() {
    const rows = await this.prisma.category.findMany({
      where: { deletedAt: null },
      orderBy: { sortOrder: "asc" },
      include: { parent: { select: { name: true } }, _count: { select: { products: true, children: true } } },
    });
    return { items: rows };
  }

  @Post("categories")
  @RequirePermission("categories.manage")
  async createCategory(@Body() body: { name: string; parentId?: string | null; description?: string; sortOrder?: number }) {
    if (!body.name?.trim()) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "نام دسته الزامی است." });
    }
    // عمق حداکثر ۵ (سطح ۱ تا ۵)
    let depth = 0;
    let pid = body.parentId ?? null;
    let walk = pid;
    while (walk) {
      depth += 1;
      if (depth > 4) {
        throw new BadRequestException({ code: "DEPTH_LIMIT", message: "حداکثر ۵ سطح دسته مجاز است." });
      }
      const parent = await this.prisma.category.findUnique({ where: { id: walk }, select: { parentId: true } });
      walk = parent?.parentId ?? null;
    }
    let slug = slugify(body.name);
    if (await this.prisma.category.findUnique({ where: { slug } })) {
      slug = `${slug}-${randomUUID().slice(0, 4)}`;
    }
    const created = await this.prisma.category.create({
      data: {
        name: body.name.trim(),
        slug,
        parentId: pid,
        description: body.description ?? null,
        sortOrder: body.sortOrder ?? 0,
      },
    });
    return created;
  }

  @Patch("categories/:id")
  @RequirePermission("categories.manage")
  async updateCategory(
    @Param("id") id: string,
    @Body() body: { name?: string; parentId?: string | null; description?: string; sortOrder?: number; status?: "PUBLISHED" | "DRAFT" | "ARCHIVED" },
  ) {
    // جلوگیری از حلقه: والد نمی‌تواند خودِ زیرشاخه باشد
    if (body.parentId === id) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "والد نمی‌تواند خود دسته باشد." });
    }
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name.trim();
    if (body.description !== undefined) data.description = body.description;
    if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;
    if (body.status !== undefined) data.status = body.status;
    if (body.parentId !== undefined) {
      let depth = 0;
      let walk = body.parentId;
      while (walk) {
        depth += 1;
        if (depth > 4) throw new BadRequestException({ code: "DEPTH_LIMIT", message: "حداکثر ۵ سطح مجاز است." });
        if (walk === id) throw new BadRequestException({ code: "CYCLE", message: "جابه‌جایی زیر خودش مجاز نیست." });
        const parent = await this.prisma.category.findUnique({ where: { id: walk }, select: { parentId: true } });
        walk = parent?.parentId ?? null;
      }
      data.parentId = body.parentId;
    }
    return this.prisma.category.update({ where: { id }, data });
  }

  @Delete("categories/:id")
  @RequirePermission("categories.manage")
  async deleteCategory(@Param("id") id: string) {
    const childCount = await this.prisma.category.count({ where: { parentId: id } });
    if (childCount > 0) {
      throw new BadRequestException({ code: "HAS_CHILDREN", message: "اول زیردسته‌ها را حذف/جابه‌جا کنید." });
    }
    const productCount = await this.prisma.product.count({ where: { categoryId: id, deletedAt: null } });
    if (productCount > 0) {
      throw new BadRequestException({ code: "HAS_PRODUCTS", message: `این دسته ${productCount} محصول دارد.` });
    }
    await this.prisma.category.delete({ where: { id } });
    return { ok: true };
  }

  // ---------- برندها ----------
  @Get("brands")
  @RequirePermission("brands.view")
  async brands() {
    const rows = await this.prisma.brand.findMany({
      orderBy: { sortOrder: "asc" },
      include: { _count: { select: { products: true } } },
    });
    return { items: rows };
  }

  @Post("brands")
  @RequirePermission("brands.manage")
  async createBrand(@Body() body: { name: string; website?: string; description?: string; logoMediaId?: string | null; sortOrder?: number }) {
    if (!body.name?.trim()) throw new BadRequestException({ code: "VALIDATION_ERROR", message: "نام برند الزامی است." });
    let slug = slugify(body.name);
    if (await this.prisma.brand.findUnique({ where: { slug } })) {
      slug = `${slug}-${randomUUID().slice(0, 4)}`;
    }
    return this.prisma.brand.create({
      data: {
        name: body.name.trim(),
        slug,
        website: body.website ?? null,
        description: body.description ?? null,
        logoId: body.logoMediaId ?? null,
        sortOrder: body.sortOrder ?? 0,
      },
    });
  }

  @Patch("brands/:id")
  @RequirePermission("brands.manage")
  async updateBrand(
    @Param("id") id: string,
    @Body() body: { name?: string; website?: string; description?: string; logoMediaId?: string | null; sortOrder?: number; status?: "PUBLISHED" | "DRAFT" | "ARCHIVED" },
  ) {
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name.trim();
    if (body.website !== undefined) data.website = body.website;
    if (body.description !== undefined) data.description = body.description;
    if (body.logoMediaId !== undefined) data.logoId = body.logoMediaId;
    if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;
    if (body.status !== undefined) data.status = body.status;
    return this.prisma.brand.update({ where: { id }, data });
  }

  @Delete("brands/:id")
  @RequirePermission("brands.manage")
  async deleteBrand(@Param("id") id: string) {
    const productCount = await this.prisma.product.count({ where: { brandId: id, deletedAt: null } });
    if (productCount > 0) {
      throw new BadRequestException({ code: "HAS_PRODUCTS", message: `این برند ${productCount} محصول دارد.` });
    }
    await this.prisma.brand.delete({ where: { id } });
    return { ok: true };
  }

  // ---------- ویژگی‌ها + مقادیر ----------
  @Get("attributes")
  @RequirePermission("attributes.view")
  async attributes() {
    const rows = await this.prisma.attribute.findMany({
      orderBy: { createdAt: "asc" },
      include: { terms: { orderBy: { sortOrder: "asc" } } },
    });
    return { items: rows };
  }

  @Post("attributes")
  @RequirePermission("attributes.manage")
  async createAttribute(@Body() body: { name: string; type?: string; isFilterable?: boolean; isVariantAxis?: boolean; terms?: Array<{ value: string; hex?: string }> }) {
    if (!body.name?.trim()) throw new BadRequestException({ code: "VALIDATION_ERROR", message: "نام ویژگی الزامی است." });
    const slug = slugify(body.name);
    if (await this.prisma.attribute.findUnique({ where: { slug } })) {
      throw new BadRequestException({ code: "DUPLICATE", message: "ویژگی هم‌نام وجود دارد." });
    }
    return this.prisma.attribute.create({
      data: {
        name: body.name.trim(),
        slug,
        type: (body.type ?? "SELECT") as never,
        isFilterable: body.isFilterable ?? true,
        isVariantAxis: body.isVariantAxis ?? false,
        terms: body.terms?.length
          ? { create: body.terms.map((t, i) => ({ value: t.value, slug: slugify(t.value), hex: t.hex ?? null, sortOrder: i })) }
          : undefined,
      },
      include: { terms: true },
    });
  }

  @Post("attributes/:id/terms")
  @RequirePermission("attributes.manage")
  async addTerm(@Param("id") id: string, @Body() body: { value: string; hex?: string }) {
    if (!body.value?.trim()) throw new BadRequestException({ code: "VALIDATION_ERROR", message: "مقدار الزامی است." });
    return this.prisma.attributeTerm.create({
      data: { attributeId: id, value: body.value.trim(), slug: slugify(body.value), hex: body.hex ?? null },
    });
  }

  @Delete("terms/:termId")
  @RequirePermission("attributes.manage")
  async deleteTerm(@Param("termId") termId: string) {
    await this.prisma.attributeTerm.delete({ where: { id: termId } });
    return { ok: true };
  }
}

void Query;
