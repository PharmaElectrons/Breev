import { Module } from "@nestjs/common";

import { DatabaseHealthService } from "./database-health.service.js";
import { DurableJobsService } from "./durable-jobs/durable-jobs.service.js";
import { HealthController } from "./health.controller.js";
import { IdentityAccessController } from "./identity-access/identity-access.controller.js";
import { IdentityAccessService } from "./identity-access/identity-access.service.js";
import { LocalDatabaseService } from "./local-database.service.js";
import { LicensingController } from "./licensing/licensing.controller.js";
import { LicensingAdministrationService } from "./licensing/licensing-administration.service.js";
import { LicensingService } from "./licensing/licensing.service.js";
import { MainDeviceProofController } from "./main-device/main-device-proof.controller.js";
import { MainDeviceSecurityService } from "./main-device/main-device-security.service.js";
import { PharmacyCaService } from "./pharmacy-ca/pharmacy-ca.service.js";

@Module({
  controllers: [
    HealthController,
    IdentityAccessController,
    LicensingController,
    MainDeviceProofController,
  ],
  providers: [
    DatabaseHealthService,
    DurableJobsService,
    IdentityAccessService,
    LocalDatabaseService,
    LicensingAdministrationService,
    LicensingService,
    MainDeviceSecurityService,
    PharmacyCaService,
  ],
})
export class AppModule {}
