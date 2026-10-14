/**
 * JWT utilities for Open Sunsama API
 * Handles token signing and verification
 */

import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import type { Secret, SignOptions } from "jsonwebtoken";

const JWT_SECRET: Secret =
  process.env.JWT_SECRET || "open-sunsama-dev-secret-change-in-production";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

/**
 * How long after an access token expires it can still be exchanged for a
 * fresh one via the refresh endpoint. This is the "sliding session" window:
 * a user who returns within this grace period after their token lapsed (e.g.
 * the app was closed for a while) is re-issued a token instead of being
 * forced to log in again. Active users (who refresh before expiry) stay
 * logged in indefinitely. Defaults to 30 days.
 */
const PARSED_LEEWAY_DAYS = Number(process.env.JWT_REFRESH_LEEWAY_DAYS);
// Guard against a non-numeric env value (e.g. "30d"): Number("30d") is NaN,
// and `NaN` comparisons are always false, which would silently disable the
// grace-window cap and let arbitrarily-old tokens be refreshed forever.
const JWT_REFRESH_LEEWAY_DAYS = Number.isFinite(PARSED_LEEWAY_DAYS)
  ? Math.max(0, PARSED_LEEWAY_DAYS)
  : 30;
const REFRESH_LEEWAY_SECONDS = JWT_REFRESH_LEEWAY_DAYS * 24 * 60 * 60;

export interface JwtPayload {
  userId: string;
  sessionId?: string;
  iat?: number;
  exp?: number;
}

/**
 * Sign a JWT token for a user
 * @param userId - The user ID to include in the token
 * @returns The signed JWT token
 */
export function signToken(
  userId: string,
  sessionId: string = randomUUID(),
): string {
  // Cast to any to bypass strict type checking on expiresIn
  // The string format like '7d' is valid at runtime
  return jwt.sign({ userId, sessionId }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN as string,
  } as SignOptions);
}

/**
 * Verify and decode a JWT token
 * @param token - The JWT token to verify
 * @returns The decoded payload containing userId
 * @throws Error if token is invalid or expired
 */
export function verifyToken(token: string): {
  userId: string;
  sessionId?: string;
} {
  const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
  return { userId: decoded.userId, sessionId: decoded.sessionId };
}

/**
 * Verify a token for the purpose of refreshing it.
 *
 * Accepts tokens that are still valid OR that expired within the refresh
 * leeway window (see {@link REFRESH_LEEWAY_SECONDS}). This lets a returning
 * user whose access token lapsed while the app was closed obtain a fresh
 * token instead of being logged out. Tokens that are expired beyond the
 * leeway, have a bad signature, or are otherwise malformed are rejected.
 *
 * @param token - The JWT token to verify
 * @returns The decoded payload containing userId
 * @throws Error if the token cannot be refreshed
 */
export function verifyTokenForRefresh(token: string): {
  userId: string;
  sessionId?: string;
} {
  let decoded: JwtPayload;
  try {
    // Fast path: a token that is still within its normal lifetime.
    decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch (error) {
    // Only expired tokens are eligible for the grace window. A bad signature
    // or malformed token is never refreshable.
    if (!(error instanceof jwt.TokenExpiredError)) {
      throw error;
    }
    decoded = jwt.verify(token, JWT_SECRET, {
      ignoreExpiration: true,
    }) as JwtPayload;
    if (typeof decoded.exp !== "number") {
      throw error;
    }
    const expiredForSeconds = Math.floor(Date.now() / 1000) - decoded.exp;
    if (expiredForSeconds > REFRESH_LEEWAY_SECONDS) {
      throw error;
    }
  }

  if (!decoded.userId) {
    throw new Error("Token is missing userId claim");
  }
  return { userId: decoded.userId, sessionId: decoded.sessionId };
}

/**
 * Decode a JWT token without verification (for debugging)
 * @param token - The JWT token to decode
 * @returns The decoded payload or null if invalid
 */
export function decodeToken(token: string): JwtPayload | null {
  const decoded = jwt.decode(token);
  if (decoded && typeof decoded === "object" && "userId" in decoded) {
    return decoded as JwtPayload;
  }
  return null;
}
