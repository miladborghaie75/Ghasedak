import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { AdminCatalogController } from "./admin-catalog.controller";

@Module({
  imports: [PrismaModule],
  controllers: [AdminCatalogController],
})
export class CatalogModule {}
