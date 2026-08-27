import { Module, type OnModuleInit } from "@nestjs/common";

import { DurableJobsService } from "../durable-jobs/durable-jobs.service.js";
import { LocalDatabaseService } from "../local-database.service.js";
import { RecoveryCoordinatorService } from "./recovery-coordinator.service.js";
import { RecoveryJobService } from "./recovery-job.service.js";
import { RecoveryController } from "./recovery.controller.js";
import {
  DeviceIdentityVerificationHook,
  LicenceTimeVerificationHook,
  MainDeviceSecurityVerificationHook,
  RestoreQuarantineService,
} from "./restore-quarantine.service.js";

@Module({
  controllers: [RecoveryController],
  exports: [
    RecoveryCoordinatorService,
    RestoreQuarantineService,
    RecoveryJobService,
  ],
  providers: [
    LocalDatabaseService,
    DurableJobsService,
    RecoveryCoordinatorService,
    RestoreQuarantineService,
    RecoveryJobService,
  ],
})
export class RecoveryModule implements OnModuleInit {
  public constructor(
    private readonly quarantineService: RestoreQuarantineService,
  ) {}

  public onModuleInit(): void {
    this.quarantineService.registerHook(
      new MainDeviceSecurityVerificationHook(),
    );
    this.quarantineService.registerHook(new DeviceIdentityVerificationHook());
    this.quarantineService.registerHook(new LicenceTimeVerificationHook());
  }
}
