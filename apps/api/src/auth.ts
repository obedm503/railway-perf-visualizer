import { and, eq, gt, lt } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import * as oidc from "openid-client";
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

type TokenSet = oidc.TokenEndpointResponse & oidc.TokenEndpointResponseHelpers;

let cachedConfiguration: oidc.Configuration | null = null;

function getRedirectUri(): string {
  return `${env.API_ORIGIN}/api/auth/callback/railway`;
}

async function getOidcConfiguration(): Promise<oidc.Configuration> {
  if (!env.RAILWAY_CLIENT_ID || !env.RAILWAY_CLIENT_SECRET) {
    throw new Error("Missing RAILWAY_CLIENT_ID or RAILWAY_CLIENT_SECRET");
  }

  if (!cachedConfiguration) {
    cachedConfiguration = await oidc.discovery(
      new URL(env.RAILWAY_OIDC_DISCOVERY_URL),
      env.RAILWAY_CLIENT_ID,
      {
        client_secret: env.RAILWAY_CLIENT_SECRET,
        redirect_uris: [getRedirectUri()],
        response_types: ["code"],
        // set to ES256 explicitly because RS256 is the default even if discovery says it's not supported
        // https://github.com/panva/openid-client/issues/509
        // https://github.com/panva/openid-client/issues/115#issuecomment-418788175
        id_token_signed_response_alg: "ES256",
      },
    );
  }

  return cachedConfiguration;
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
  const expiresInSeconds =
    typeof tokenSet.expiresIn === "function"
      ? tokenSet.expiresIn()
      : tokenSet.expires_in;
  if (typeof expiresInSeconds !== "number") {
    return null;
  }

  return new Date(Date.now() + expiresInSeconds * 1000);
}

function boolFromUnknown(value: unknown): boolean {
  return value === true || value === "true" || value === 1;
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function resolveProfile(
  config: oidc.Configuration,
  tokenSet: TokenSet,
): Promise<Record<string, unknown>> {
  const idTokenClaims = (tokenSet.claims() ?? {}) as Record<string, unknown>;
  const providerSubject = toNullableString(idTokenClaims.sub);
  if (!providerSubject || !tokenSet.access_token) {
    return idTokenClaims;
  }

  try {
    const userInfo = await oidc.fetchUserInfo(
      config,
      tokenSet.access_token,
      providerSubject,
    );
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
    const configuration = await getOidcConfiguration();
    const state = oidc.randomState();
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
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
    return oidc
      .buildAuthorizationUrl(configuration, {
        redirect_uri: getRedirectUri(),
        scope: this.scopes,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        prompt: "consent", // set to include a refresh token
      })
      .toString();
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

    const configuration = await getOidcConfiguration();
    const callbackUrl = new URL(getRedirectUri());
    callbackUrl.searchParams.set("code", code);
    callbackUrl.searchParams.set("state", state);
    callbackUrl.searchParams.set("iss", iss);

    const tokenSet = await oidc.authorizationCodeGrant(
      configuration,
      callbackUrl,
      {
        expectedState: state,
        pkceCodeVerifier: storedState.codeVerifier,
      },
    );
    log.info({ handleCallback: { tokenSet } });

    const profile = await resolveProfile(configuration, tokenSet);
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
      const configuration = await getOidcConfiguration();
      const tokenSet = await oidc.refreshTokenGrant(
        configuration,
        identity.refreshToken,
      );
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
