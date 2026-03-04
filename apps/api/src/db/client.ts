import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";
import { env } from "../env";

mkdirSync(dirname(env.DATABASE_PATH), { recursive: true });

const sqlite = new Database(env.DATABASE_PATH, { create: true });

sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA foreign_keys = ON;");

export const db = drizzle(sqlite, { schema });
