import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { PhotographyController } from "./photography.controller";
import { PhotographyService } from "./photography.service";

@Module({
  imports: [PrismaModule],
  controllers: [PhotographyController],
  providers: [PhotographyService],
})
export class PhotographyModule {}
