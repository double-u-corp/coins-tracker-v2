import { createHmac, timingSafeEqual } from "crypto";
import type { NextApiRequest } from "next";
import type { GetServerSidePropsContext } from "next";

export const SESSION_COOKIE_NAME = "coins_tracker_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

/**
 * Simple, dependency-free auth for a single-user personal app: one
 * username/password pair from env vars, and a signed (not encrypted)
 * session cookie so we don't need a sessions table or a JWT library.
 *
 * This is intentionally minimal — there's no user table, no password
 * hashing UI, no rate limiting. Good enough to keep the Buy/Manage
 * Coins/cron-trigger actions away from casual visitors; not a substitute
 * for real auth if you expose this app publicly with real money data.
 */
function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    // Fail loudly in production; fall back to a fixed dev value locally so
    // `npm run dev` works without extra setup.
    if (process.env.NODE_ENV === "production") {
      throw new Error("AUTH_SECRET environment variable is not set");
    }
    return "dev-only-insecure-secret";
  }
  return secret;
}

function sign(value: string): string {
  return createHmac("sha256", getSecret()).update(value).digest("hex");
}

/** Builds a signed session token: "<username>.<expiryMs>.<signatureHex>". */
export function createSessionToken(username: string): string {
  const expiresAt = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  const payload = `${username}.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

function verifySessionToken(token: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [username, expiresAtRaw, signature] = parts;
  const payload = `${username}.${expiresAtRaw}`;
  const expected = sign(payload);

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

  const expiresAt = Number(expiresAtRaw);
  if (Number.isNaN(expiresAt) || Date.now() > expiresAt) return false;

  return true;
}

/** Checks a username/password pair against the configured credentials. */
export function verifyCredentials(username: string, password: string): boolean {
  const expectedUsername = process.env.AUTH_USERNAME ?? "";
  const expectedPassword = process.env.AUTH_PASSWORD ?? "";
  if (!expectedUsername || !expectedPassword) return false;

  const userBuf = Buffer.from(username);
  const expectedUserBuf = Buffer.from(expectedUsername);
  const passBuf = Buffer.from(password);
  const expectedPassBuf = Buffer.from(expectedPassword);

  const usernameMatches =
    userBuf.length === expectedUserBuf.length && timingSafeEqual(userBuf, expectedUserBuf);
  const passwordMatches =
    passBuf.length === expectedPassBuf.length && timingSafeEqual(passBuf, expectedPassBuf);

  return usernameMatches && passwordMatches;
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  return Object.fromEntries(
    cookieHeader.split(";").map((pair) => {
      const [key, ...rest] = pair.trim().split("=");
      return [key, decodeURIComponent(rest.join("="))];
    })
  );
}

/** Reads and verifies the session cookie from an API request. */
export function isAuthenticatedRequest(req: NextApiRequest): boolean {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE_NAME];
  return typeof token === "string" && verifySessionToken(token);
}

/** Reads and verifies the session cookie from a getServerSideProps context. */
export function isAuthenticatedSSR(context: GetServerSidePropsContext): boolean {
  const cookies = parseCookies(context.req.headers.cookie);
  const token = cookies[SESSION_COOKIE_NAME];
  return typeof token === "string" && verifySessionToken(token);
}

/**
 * Drop into a page's getServerSideProps to redirect unauthenticated visitors
 * to /login before any protected content is rendered. Usage:
 *
 *   export const getServerSideProps: GetServerSideProps = async (context) => {
 *     const redirect = requireAuthSSR(context);
 *     if (redirect) return redirect;
 *     return { props: {} };
 *   };
 */
export function requireAuthSSR(context: GetServerSidePropsContext) {
  if (isAuthenticatedSSR(context)) return null;
  return {
    redirect: {
      destination: `/login?redirect=${encodeURIComponent(context.resolvedUrl)}`,
      permanent: false,
    },
  };
}

export function buildSessionCookie(token: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(
    token
  )}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}${secure}`;
}

export function buildLogoutCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}
