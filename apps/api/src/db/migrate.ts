import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { db } from "./client";

const migrationsFolder = `${import.meta.dir}/../../drizzle`;

export const runMigrations = async (): Promise<void> => {
  migrate(db, { migrationsFolder });
};

if (import.meta.path === Bun.main) {
  await runMigrations();
}
