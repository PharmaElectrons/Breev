import { Injectable } from "@nestjs/common";

import { LocalDatabaseService } from "./local-database.service.js";

@Injectable()
export class DatabaseHealthService {
  public constructor(private readonly localDatabase: LocalDatabaseService) {}

  public async isAvailable(): Promise<boolean> {
    return await this.localDatabase.isAvailable();
  }
}
