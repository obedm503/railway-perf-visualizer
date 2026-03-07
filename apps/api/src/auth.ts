import { and, eq, gt, lt } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { generators, Issuer, type Client, type TokenSet } from "openid-client";
import { db } from "./db/client";
import {
  identities,
  oauthStates,
  sessions,
  users,
  type UserRow,
} from "./db/schema";
import { env } from "./env";
import { log } from "evlog";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 21);

const PROVIDER = "railway";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

let cachedClient: Client | null = null;

function getRedirectUri(): string {
  return `${env.API_ORIGIN}/api/auth/callback/railway`;
}

async function getOidcClient(): Promise<Client> {
  if (!env.RAILWAY_CLIENT_ID || !env.RAILWAY_CLIENT_SECRET) {
    throw new Error("Missing RAILWAY_CLIENT_ID or RAILWAY_CLIENT_SECRET");
  }

  if (!cachedClient) {
    const issuer = await Issuer.discover(env.RAILWAY_OIDC_DISCOVERY_URL);
    // const meta = await fetch(env.RAILWAY_OIDC_DISCOVERY_URL).then((r) =>
    //   r.json(),
    // );
    // const issuer = new Issuer({
    //   ...meta,
    //   authorization_response_iss_parameter_supported: false,
    // });
    cachedClient = new issuer.Client({
      client_id: env.RAILWAY_CLIENT_ID!,
      client_secret: env.RAILWAY_CLIENT_SECRET!,
      redirect_uris: [getRedirectUri()],
      response_types: ["code"],
      // set to ES256 explicitly because RS256 is the default even if discovery says it's not supported
      // https://github.com/panva/openid-client/issues/509
      // https://github.com/panva/openid-client/issues/115#issuecomment-418788175
      id_token_signed_response_alg: "ES256",
    });
  }

  return cachedClient;
}

function normalizeCallbackUrl(input: string | null): string {
  if (!input) {
    return `${env.WEB_ORIGIN}/`;
  }

  try {
    const candidate = new URL(input);
    const allowed = new URL(env.WEB_ORIGIN);
    if (candidate.origin !== allowed.origin) {
      return `${env.WEB_ORIGIN}/`;
    }
    return candidate.toString();
  } catch {
    return `${env.WEB_ORIGIN}/`;
  }
}

function getTokenExpiry(tokenSet: TokenSet): Date | null {
  if (!tokenSet.expires_at) {
    return null;
  }
  return new Date(tokenSet.expires_at * 1000);
}

function boolFromUnknown(value: unknown): boolean {
  return value === true || value === "true" || value === 1;
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function resolveProfile(
  client: Client,
  tokenSet: TokenSet,
): Promise<Record<string, unknown>> {
  const idTokenClaims = tokenSet.claims() as Record<string, unknown>;

  try {
    const userInfo = (await client.userinfo(tokenSet)) as Record<
      string,
      unknown
    >;
    return { ...idTokenClaims, ...userInfo };
  } catch {
    return idTokenClaims;
  }
}

async function upsertIdentityAndUser(
  profile: Record<string, unknown>,
  tokenSet: TokenSet,
): Promise<UserRow> {
  const providerSubject = toNullableString(profile.sub);
  if (!providerSubject) {
    throw new Error("OIDC profile missing required subject");
  }

  const now = new Date();
  const existing = await db.query.identities.findFirst({
    columns: { id: true, userId: true },
    where: and(
      eq(identities.provider, PROVIDER),
      eq(identities.providerSubject, providerSubject),
    ),
  });

  const userId = existing?.userId ?? nanoid();
  const userPatch = {
    providerSubject,
    email: toNullableString(profile.email),
    emailVerified: boolFromUnknown(profile.email_verified),
    name: toNullableString(profile.name),
    picture: toNullableString(profile.picture),
    updatedAt: now,
  };

  if (!existing) {
    await db.insert(users).values({
      id: userId,
      createdAt: now,
      ...userPatch,
    });
  } else {
    await db.update(users).set(userPatch).where(eq(users.id, userId));
  }

  const identityPatch = {
    userId,
    accessToken: tokenSet.access_token ?? null,
    refreshToken: tokenSet.refresh_token ?? null,
    idToken: tokenSet.id_token ?? null,
    scope: tokenSet.scope ?? null,
    tokenType: tokenSet.token_type ?? null,
    expiresAt: getTokenExpiry(tokenSet),
    updatedAt: now,
  };

  if (!existing) {
    await db.insert(identities).values({
      id: nanoid(),
      provider: PROVIDER,
      providerSubject,
      createdAt: now,
      ...identityPatch,
    });
  } else {
    await db
      .update(identities)
      .set(identityPatch)
      .where(
        and(
          eq(identities.provider, PROVIDER),
          eq(identities.providerSubject, providerSubject),
        ),
      );
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });
  if (!user) {
    throw new Error("Failed to load user after upsert");
  }

  return user;
}

export const auth = {
  scopes: [
    "openid",
    "email",
    "profile",
    "offline_access",
    "workspace:viewer",
    // "project:viewer",
    "project:member",
  ].join(" "),

  sessionMaxAgeSeconds: SESSION_TTL_SECONDS,

  async createLoginUrl(callbackURL: string | null): Promise<string> {
    const client = await getOidcClient();
    const state = generators.state();
    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);
    const now = new Date();

    await db.delete(oauthStates).where(lt(oauthStates.expiresAt, now));

    await db.insert(oauthStates).values({
      state,
      codeVerifier,
      callbackUrl: normalizeCallbackUrl(callbackURL),
      createdAt: now,
      expiresAt: new Date(now.getTime() + OAUTH_STATE_TTL_MS),
    });

    // see https://docs.railway.com/integrations/oauth/login-and-tokens#initiating-login
    return client.authorizationUrl({
      response_type: "code",
      client_id: env.RAILWAY_CLIENT_ID,
      redirect_uri: getRedirectUri(),
      scope: this.scopes,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      prompt: "consent", // set to include a refresh token
    });
  },

  async handleCallback({
    code,
    iss,
    state,
  }: {
    code: string;
    state: string;
    iss: string;
  }): Promise<{
    callbackUrl: string;
    sessionId: string;
  }> {
    const now = new Date();
    const storedState = await db.query.oauthStates.findFirst({
      where: and(eq(oauthStates.state, state), gt(oauthStates.expiresAt, now)),
    });

    await db.delete(oauthStates).where(eq(oauthStates.state, state));

    if (!storedState) {
      throw new Error("Invalid or expired OAuth state");
    }

    const client = await getOidcClient();
    const tokenSet = await client.callback(
      getRedirectUri(),
      { code, state, iss },
      {
        state,
        code_verifier: storedState.codeVerifier,
      },
    );
    log.info({ handleCallback: { tokenSet } });

    const profile = await resolveProfile(client, tokenSet);
    const user = await upsertIdentityAndUser(profile, tokenSet);

    const sessionId = nanoid();
    const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);

    await db.insert(sessions).values({
      id: sessionId,
      userId: user.id,
      createdAt: now,
      expiresAt,
    });

    return {
      callbackUrl: storedState.callbackUrl,
      sessionId,
    };
  },

  async resolveSession(
    sessionId: string | null,
  ): Promise<{ user: UserRow | null; sessionId: string | null }> {
    if (!sessionId) {
      return { user: null, sessionId: null };
    }

    const now = new Date();
    const result = await db.query.sessions.findFirst({
      where: and(eq(sessions.id, sessionId), gt(sessions.expiresAt, now)),
      with: { user: true },
    });

    if (!result) {
      await db
        .delete(sessions)
        .where(and(eq(sessions.id, sessionId), lt(sessions.expiresAt, now)));
      return { user: null, sessionId: null };
    }

    return { user: result.user, sessionId: result.id };
  },

  async deleteSession(sessionId: string | null): Promise<void> {
    if (!sessionId) {
      return;
    }
    await db.delete(sessions).where(eq(sessions.id, sessionId));
  },

  async getAccessToken(userId: string): Promise<string | null> {
    const identity = await db.query.identities.findFirst({
      where: and(
        eq(identities.userId, userId),
        eq(identities.provider, PROVIDER),
      ),
    });

    console.log("getAccessToken", { identity });
    if (!identity?.accessToken) {
      return null;
    }

    const bufferMs = 60_000;
    if (
      !identity.expiresAt ||
      identity.expiresAt.getTime() - bufferMs > Date.now()
    ) {
      return identity.accessToken;
    }

    if (!identity.refreshToken) {
      return null;
    }

    try {
      const client = await getOidcClient();
      const tokenSet = await client.refresh(identity.refreshToken);
      console.log("getAccessToken", { tokenSet });

      if (!tokenSet.access_token) {
        return null;
      }

      await db
        .update(identities)
        .set({
          accessToken: tokenSet.access_token,
          refreshToken: tokenSet.refresh_token ?? identity.refreshToken,
          expiresAt: getTokenExpiry(tokenSet),
          updatedAt: new Date(),
        })
        .where(
          and(eq(identities.userId, userId), eq(identities.provider, PROVIDER)),
        );

      return tokenSet.access_token;
    } catch (e) {
      log.error({ error: e });
      return null;
    }
  },
};
