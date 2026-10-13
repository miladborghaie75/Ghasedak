import { Module } from "@nestjs/common";
import { GeoController } from "./geo.controller";
import { PrismaModule } from "../prisma/prisma.module";

@Module({
  imports: [PrismaModule],
  controllers: [GeoController],
})
export class GeoModule {}
