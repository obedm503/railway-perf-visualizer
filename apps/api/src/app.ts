import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RequestLogger } from "evlog";
import { createRequestLogger } from "evlog";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { auth } from "./auth";
import type { UserRow } from "./db/schema";
import { env } from "./env";

const webDistPath = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../web/dist",
);
const sessionCookieName = "rv_session";

type Variables = {
  log: RequestLogger;
  user: UserRow | null;
  sessionId: string | null;
};

const serveWebStatic = serveStatic({
  root: webDistPath,
  rewriteRequestPath(path) {
    return path === "/" ? "/index.html" : path;
  },
});
const serveWebFallback = serveStatic({
  root: webDistPath,
  path: "/index.html",
});

async function requestLoggingMiddleware(
  c: Context<{ Variables: Variables }>,
  next: Next,
) {
  const startedAt = Date.now();
  const log = createRequestLogger({
    method: c.req.method,
    path: c.req.path,
    requestId: c.req.header("X-Railway-Request-Id"),
  });
  c.set("log", log);
  log.set({ region: c.req.header("X-Railway-Edge") });

  try {
    await next();
  } catch (error) {
    log.error(error as Error);
    throw error;
  } finally {
    log.emit({
      status: c.res.status,
      duration: Date.now() - startedAt,
    });
  }
}

export const app = new Hono<{ Variables: Variables }>()
  .use("/_health", requestLoggingMiddleware)
  .use("/api/*", requestLoggingMiddleware)
  .get("/_health", (c) => {
    c.get("log").set({ route: "health" });
    return c.text("ok");
  })
  .use(
    "/api/*",
    cors({
      origin(origin) {
        if (!origin) {
          return env.WEB_ORIGIN;
        }
        return origin === env.WEB_ORIGIN ? origin : "";
      },
      credentials: true,
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
    }),
  )
  .use("/api/*", async (c, next) => {
    const sessionId = getCookie(c, sessionCookieName) ?? null;
    const authSession = await auth.resolveSession(sessionId);
    c.set("user", authSession.user);
    c.set("sessionId", authSession.sessionId);
    await next();
  })
  .get("/api/auth/login", async (c) => {
    const location = await auth.createLoginUrl(
      c.req.query("callbackURL") ?? null,
    );
    return c.redirect(location, 302);
  })
  .get("/api/auth/callback/railway", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");

    if (!code || !state) {
      return c.json({ error: "Missing OAuth callback parameters" }, 400);
    }

    const result = await auth.handleCallback(code, state);

    setCookie(c, sessionCookieName, result.sessionId, {
      path: "/",
      maxAge: auth.sessionMaxAgeSeconds,
      httpOnly: true,
      sameSite: "Lax",
      secure: process.env.NODE_ENV === "production",
    });

    return c.redirect(result.callbackUrl, 302);
  })
  .post("/api/auth/logout", async (c) => {
    const sessionId = getCookie(c, sessionCookieName) ?? null;
    await auth.deleteSession(sessionId);
    deleteCookie(c, sessionCookieName, {
      path: "/",
      secure: process.env.NODE_ENV === "production",
      sameSite: "Lax",
    });

    return c.json({ ok: true });
  })
  .get("/api/me", (c) => {
    const user = c.get("user");

    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    return c.json({
      id: user.id,
      sub: user.providerSubject,
      email: user.email,
      emailVerified: user.emailVerified,
      name: user.name,
      picture: user.picture,
    });
  })
  .use("*", async (c, next) => {
    if (c.req.path.startsWith("/api/")) {
      await next();
      return;
    }

    await serveWebStatic(c, next);
  })
  .get("*", async (c, next) => {
    if (c.req.path.startsWith("/api/")) {
      return c.notFound();
    }

    return serveWebFallback(c, next);
  });

export type AppType = typeof app;
