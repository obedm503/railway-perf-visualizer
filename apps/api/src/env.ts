export const env = {
  PORT: Number(process.env.PORT ?? 8787),
  API_ORIGIN: process.env.API_ORIGIN ?? "http://localhost:8787",
  WEB_ORIGIN: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  DATABASE_PATH: process.env.DATABASE_PATH ?? "./data/auth.db",
  RAILWAY_OIDC_DISCOVERY_URL:
    process.env.RAILWAY_OIDC_DISCOVERY_URL ??
    "https://backboard.railway.com/oauth/.well-known/openid-configuration",
  RAILWAY_CLIENT_ID: process.env.RAILWAY_CLIENT_ID,
  RAILWAY_CLIENT_SECRET: process.env.RAILWAY_CLIENT_SECRET,
};
