import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { AdminCatalogController } from "./admin-catalog.controller";
import { PublicCatalogController } from "./public-catalog.controller";

@Module({
  imports: [PrismaModule],
  controllers: [AdminCatalogController, PublicCatalogController],
})
export class CatalogModule {}
