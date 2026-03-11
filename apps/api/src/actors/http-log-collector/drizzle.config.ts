import { defineConfig } from "rivetkit/db/drizzle";
import type { Config } from "drizzle-kit";

const config: Config = defineConfig({
  schema: "./src/actors/http-log-collector/schema.ts",
  out: "./src/actors/http-log-collector/drizzle",
});

export default config;
