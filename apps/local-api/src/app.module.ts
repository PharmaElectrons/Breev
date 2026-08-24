import { Module } from "@nestjs/common";

import { DatabaseHealthService } from "./database-health.service.js";
import { HealthController } from "./health.controller.js";

@Module({
  controllers: [HealthController],
  providers: [DatabaseHealthService],
})
export class AppModule {}
