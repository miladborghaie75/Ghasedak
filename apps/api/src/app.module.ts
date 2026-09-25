import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { HealthModule } from "./health/health.module";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { ProductsModule } from "./products/products.module";
import { AccountingModule } from "./accounting/accounting.module";
import { InventoryModule } from "./inventory/inventory.module";
import { OrdersModule } from "./orders/orders.module";
import { PaymentsModule } from "./payments/payments.module";
import { PosModule } from "./pos/pos.module";
import { ReturnsModule } from "./returns/returns.module";
import { ShippingModule } from "./shipping/shipping.module";
import { EventsModule } from "./events/events.module";
import { CatalogModule } from "./catalog/catalog.module";
import { CustomersModule } from "./customers/customers.module";
import { PricingModule } from "./pricing/pricing.module";
import { AdminPanelModule } from "./admin/admin-panel.module";
import { PermissionsGuard } from "./auth/permissions.guard";
import { RequestIdMiddleware } from "./common/request-id.middleware";
import { BigIntJsonMiddleware } from "./common/bigint-serializer.middleware";
import { RateLimitMiddleware } from "./common/rate-limit.middleware";

/**
 * ماژول ریشه — ماژول‌های دامنه (بند ۱۰۸) یک‌به‌یک اضافه می‌شوند.
 * PermissionsGuard سراسری: مجوز در همه مسیرهای @RequirePermission به‌صورت server-side چک می‌شود (بند ۷).
 */
@Module({
  imports: [PrismaModule, HealthModule, AuthModule, ProductsModule, AccountingModule, InventoryModule, OrdersModule, PaymentsModule, PosModule, ReturnsModule, ShippingModule, EventsModule, CatalogModule, AdminPanelModule, CustomersModule, PricingModule],
  providers: [{ provide: APP_GUARD, useClass: PermissionsGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes("*");
    consumer.apply(BigIntJsonMiddleware).forRoutes("*");
    consumer.apply(RateLimitMiddleware).forRoutes("auth", "orders");
  }
}
