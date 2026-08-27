import { Module } from "@nestjs/common";

import { DatabaseHealthService } from "./database-health.service.js";
import { DurableJobsService } from "./durable-jobs/durable-jobs.service.js";
import { HealthController } from "./health.controller.js";
import { IdentityAccessController } from "./identity-access/identity-access.controller.js";
import { IdentityAccessService } from "./identity-access/identity-access.service.js";
import { LocalDatabaseService } from "./local-database.service.js";
import { MainDeviceProofController } from "./main-device/main-device-proof.controller.js";
import { MainDeviceSecurityService } from "./main-device/main-device-security.service.js";
import { PharmacyCaService } from "./pharmacy-ca/pharmacy-ca.service.js";
import { RecoveryCoordinatorService } from "./recovery/recovery-coordinator.service.js";
import { RecoveryJobService } from "./recovery/recovery-job.service.js";
import { RecoveryController } from "./recovery/recovery.controller.js";
import { RestoreQuarantineService } from "./recovery/restore-quarantine.service.js";

@Module({
  controllers: [
    HealthController,
    IdentityAccessController,
    MainDeviceProofController,
    RecoveryController,
  ],
  providers: [
    DatabaseHealthService,
    DurableJobsService,
    IdentityAccessService,
    LocalDatabaseService,
    MainDeviceSecurityService,
    PharmacyCaService,
    RecoveryCoordinatorService,
    RestoreQuarantineService,
    RecoveryJobService,
  ],
})
export class AppModule {}
