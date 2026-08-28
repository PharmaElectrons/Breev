import { Module } from "@nestjs/common";

import { DatabaseHealthService } from "./database-health.service.js";
import { DurableJobsService } from "./durable-jobs/durable-jobs.service.js";
import { HealthController } from "./health.controller.js";
import { IdentityAccessController } from "./identity-access/identity-access.controller.js";
import { IdentityAccessService } from "./identity-access/identity-access.service.js";
import { SettingsPostCommitService } from "./identity-access/settings-post-commit.service.js";
import { LocalDatabaseService } from "./local-database.service.js";
import { LicensingController } from "./licensing/licensing.controller.js";
import { LicensingAdministrationService } from "./licensing/licensing-administration.service.js";
import { LicensingService } from "./licensing/licensing.service.js";
import { MainDeviceProofController } from "./main-device/main-device-proof.controller.js";
import { MainDeviceSecurityService } from "./main-device/main-device-security.service.js";
import { PharmacyCaService } from "./pharmacy-ca/pharmacy-ca.service.js";
import { RecoveryCoordinatorService } from "./recovery/recovery-coordinator.service.js";
import { readMachineRecoveryKey } from "./recovery/recovery-crypto.js";
import { RecoveryJobService } from "./recovery/recovery-job.service.js";
import { RECOVERY_KEY_PROVIDER } from "./recovery/recovery-key-provider.js";
import { RecoveryController } from "./recovery/recovery.controller.js";
import { RestoreQuarantineService } from "./recovery/restore-quarantine.service.js";

@Module({
  controllers: [
    HealthController,
    IdentityAccessController,
    LicensingController,
    MainDeviceProofController,
    RecoveryController,
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
    { provide: RECOVERY_KEY_PROVIDER, useValue: readMachineRecoveryKey },
    RecoveryCoordinatorService,
    RestoreQuarantineService,
    RecoveryJobService,
    SettingsPostCommitService,
  ],
})
export class AppModule {}
