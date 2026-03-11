const PORT = Number(process.env.PORT ?? 8787);
export const env = {
  PORT,
  API_ORIGIN: process.env.API_ORIGIN ?? `http://localhost:${PORT}`,
  DATABASE_PATH: process.env.DATABASE_PATH ?? "./data/auth.db",
  RAILWAY_OIDC_DISCOVERY_URL:
    process.env.RAILWAY_OIDC_DISCOVERY_URL ??
    "https://backboard.railway.com/oauth/.well-known/openid-configuration",
  RAILWAY_CLIENT_ID: process.env.RAILWAY_CLIENT_ID,
  RAILWAY_CLIENT_SECRET: process.env.RAILWAY_CLIENT_SECRET,
  RIVET_PATH: process.env.RIVET_PATH,
};
