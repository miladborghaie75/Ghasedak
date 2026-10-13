import { Module, forwardRef } from "@nestjs/common";
import { ProductsController } from "./products.controller";
import { ProductsService } from "./products.service";
import { AccountingModule } from "../accounting/accounting.module";

/**
 * `forwardRef` لازم است چون وابستگی حلقوی داریم:
 *   محصولات → حسابداری (برای سند موجودی آغازین)
 *   حسابداری → … → کاتالوگ/محصولات (برای نام‌ها و گزارش‌ها)
 * بدون این، Nest در boot شکست می‌خورد. هر دو طرف باید `forwardRef` داشته باشند.
 */
@Module({
  imports: [forwardRef(() => AccountingModule)],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}