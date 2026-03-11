import { serve } from "bun";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { initLogger, log, parseError } from "evlog";
import { ContentfulStatusCode } from "hono/utils/http-status";
import { app } from "./app";
import { db } from "./db/client";
import { env } from "./env";

initLogger({
  env: {
    service: "railway-perf-visualizer-api",
  },
  pretty: process.env.NODE_ENV !== "production",
});

log.info({
  event: "api_startup",
  apiOrigin: env.API_ORIGIN,
  webOrigin: env.WEB_ORIGIN,
  railwayOidcDiscoveryUrl: env.RAILWAY_OIDC_DISCOVERY_URL,
});

if (!env.RAILWAY_CLIENT_ID || !env.RAILWAY_CLIENT_SECRET) {
  log.warn({
    event: "railway_oauth_disabled",
    reason: "Missing RAILWAY_CLIENT_ID or RAILWAY_CLIENT_SECRET",
  });
}

migrate(db, { migrationsFolder: `${import.meta.dir}/../drizzle` });

log.info({
  event: "db_migrations_applied",
  databasePath: env.DATABASE_PATH,
});

app.onError((error, c) => {
  c.get("log").error(error);
  const parsed = parseError(error);

  return c.json(
    {
      message: parsed.message,
      why: parsed.why,
      fix: parsed.fix,
      link: parsed.link,
    },
    parsed.status as ContentfulStatusCode,
  );
});

serve({
  port: env.PORT,
  fetch: app.fetch,
});

log.info({
  event: "api_listening",
  port: env.PORT,
});
