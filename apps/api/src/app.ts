import type { RequestLogger } from "evlog";
import { createRequestLogger } from "evlog";
import type { Context, Next } from "hono";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "rivetkit/client";
import { registry } from "./actors";
import { auth } from "./auth";
import type { UserRow } from "./db/schema";
import { env } from "./env";
import { fetchServiceInstance, fetchWorkspaces } from "./railway";

const client = createClient<typeof registry>({
  endpoint: env.API_ORIGIN + "/api/rivet",
});

const webDistPath = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../web/dist",
);
const sessionCookieName = "rv_session";

type Variables = {
  log: RequestLogger;
  user: (UserRow & { railwayAccessToken: string }) | null;
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

async function requireAuth(c: Context<{ Variables: Variables }>, next: Next) {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
}

export const app = new Hono<{ Variables: Variables }>()
  .all("/api/rivet/*", (c) => registry.handler(c.req.raw))
  .all(requestLoggingMiddleware)
  .get("/_health", (c) => {
    c.get("log").set({ route: "health" });
    return c.text("ok");
  })
  .use("/api/*", async (c, next) => {
    const sessionId = getCookie(c, sessionCookieName) ?? null;
    const authSession = await auth.resolveSession(sessionId);
    const accessToken =
      authSession.user && (await auth.getAccessToken(authSession.user.id));
    c.get("log").set({ accessToken });
    c.set(
      "user",
      authSession.user && accessToken
        ? { ...authSession.user, railwayAccessToken: accessToken }
        : null,
    );
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
    const iss = c.req.query("iss");

    if (!code || !state || !iss) {
      return c.json({ error: "Missing OAuth callback parameters" }, 400);
    }

    const result = await auth.handleCallback({ code, state, iss });

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
  .get("/api/me", requireAuth, (c) => {
    const user = c.get("user")!;

    return c.json({
      id: user.id,
      sub: user.providerSubject,
      email: user.email,
      emailVerified: user.emailVerified,
      name: user.name,
      picture: user.picture,
    });
  })
  .get("/api/me/workspaces", requireAuth, async (c) => {
    const user = c.get("user")!;
    const workspaces = await fetchWorkspaces(user.railwayAccessToken);
    return c.json({ workspaces });
  })
  .get(
    "/api/service/:serviceId/:environmentId/logs",
    requireAuth,
    async (c) => {
      const user = c.get("user")!;
      const { serviceId, environmentId } = c.req.param();
      const before = c.req.query("before") ?? undefined;
      const limitParam = c.req.query("limit");
      const limit = limitParam ? Number(limitParam) : undefined;

      c.get("log").set({ logs: { serviceId, environmentId } });
      const actor = client.httpLogCollector.getOrCreate(
        [serviceId, environmentId],
        {
          createWithInput: {
            serviceId,
            environmentId,
            userId: user.id,
          },
        },
      );

      // Ensure the actor uses the latest user's token
      await actor.updateUser(user.id);

      const result = await actor.getLogsPage({ before, limit });
      return c.json(result);
    },
  )
  .get("/api/service/:serviceId/:environmentId", requireAuth, async (c) => {
    const user = c.get("user")!;
    const { serviceId, environmentId } = c.req.param();
    const serviceInstance = await fetchServiceInstance(
      user.railwayAccessToken,
      serviceId,
      environmentId,
    );

    const actor = client.httpLogCollector.getOrCreate(
      [serviceId, environmentId],
      {
        createWithInput: {
          serviceId,
          environmentId,
          userId: user.id,
        },
      },
    );

    await actor.updateUser(user.id);

    return c.json({ serviceInstance });
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
