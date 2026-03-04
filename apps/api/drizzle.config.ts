import { defineConfig } from "drizzle-kit";
import { env } from "./src/env";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: env.DATABASE_PATH,
  },
});
