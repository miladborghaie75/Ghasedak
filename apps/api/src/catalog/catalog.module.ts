import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { AdminCatalogController } from "./admin-catalog.controller";
import { AdminNeedFinderController } from "./admin-need-finder.controller";
import { NeedFinderController } from "./need-finder.controller";
import { PublicCatalogController } from "./public-catalog.controller";

@Module({
  imports: [PrismaModule],
  controllers: [
    AdminCatalogController,
    AdminNeedFinderController,
    NeedFinderController,
    PublicCatalogController,
  ],
})
export class CatalogModule {}
