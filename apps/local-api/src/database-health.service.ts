import { Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";

@Injectable()
export class DatabaseHealthService implements OnApplicationShutdown {
  private readonly database: NodePgDatabase | undefined;
  private readonly pool: Pool | undefined;

  public constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (connectionString === undefined || connectionString.length === 0) {
      return;
    }

    this.pool = new Pool({
      connectionString,
      connectionTimeoutMillis: 1_000,
      idleTimeoutMillis: 1_000,
      max: 2,
    });
    this.pool.on("error", () => undefined);
    this.database = drizzle({ client: this.pool });
  }

  public async isAvailable(): Promise<boolean> {
    if (this.database === undefined) {
      return false;
    }

    try {
      await this.database.execute(sql`select 1 as breev_health`);
      return true;
    } catch {
      return false;
    }
  }

  public async onApplicationShutdown(): Promise<void> {
    await this.pool?.end();
  }
}
