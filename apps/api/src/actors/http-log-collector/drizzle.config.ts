import { defineConfig } from "rivetkit/db/drizzle";

export default defineConfig({
  schema: "./src/actors/http-log-collector/schema.ts",
  out: "./src/actors/http-log-collector/drizzle",
});
