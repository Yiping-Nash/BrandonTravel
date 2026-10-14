/**
 * Tests for JWT utilities, focused on the sliding-session refresh logic
 * that keeps users logged in across token expiry.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import jwt from "jsonwebtoken";
import type * as JwtModule from "./jwt.js";

// Pin the secret + leeway BEFORE the module under test is (dynamically)
// imported so it captures these values at evaluation time.
const SECRET = "test-secret-key-for-jwt-tests-min-32-chars";
process.env.JWT_SECRET = SECRET;
process.env.JWT_REFRESH_LEEWAY_DAYS = "30";

let signToken: typeof JwtModule.signToken;
let verifyToken: typeof JwtModule.verifyToken;
let verifyTokenForRefresh: typeof JwtModule.verifyTokenForRefresh;

beforeAll(async () => {
  const mod = await import("./jwt.js");
  signToken = mod.signToken;
  verifyToken = mod.verifyToken;
  verifyTokenForRefresh = mod.verifyTokenForRefresh;
});

const USER_ID = "11111111-1111-1111-1111-111111111111";
const nowSec = () => Math.floor(Date.now() / 1000);

describe("signToken / verifyToken", () => {
  it("round-trips a userId through a freshly signed token", () => {
    const token = signToken(USER_ID);
    expect(verifyToken(token).userId).toBe(USER_ID);
  });

  it("rejects an expired token", () => {
    const expired = jwt.sign({ userId: USER_ID, exp: nowSec() - 60 }, SECRET);
    expect(() => verifyToken(expired)).toThrow();
  });
});

describe("verifyTokenForRefresh", () => {
  it("refreshes a still-valid token", () => {
    const token = signToken(USER_ID);
    expect(verifyTokenForRefresh(token).userId).toBe(USER_ID);
  });

  it("refreshes a token that expired within the grace window", () => {
    // Expired 1 hour ago — well inside the 30-day leeway.
    const recentlyExpired = jwt.sign(
      { userId: USER_ID, exp: nowSec() - 60 * 60 },
      SECRET,
    );
    expect(verifyTokenForRefresh(recentlyExpired).userId).toBe(USER_ID);
  });

  it("rejects a token expired beyond the grace window", () => {
    // Expired 40 days ago — past the 30-day leeway.
    const longExpired = jwt.sign(
      { userId: USER_ID, exp: nowSec() - 40 * 24 * 60 * 60 },
      SECRET,
    );
    expect(() => verifyTokenForRefresh(longExpired)).toThrow();
  });

  it("rejects a token signed with the wrong secret", () => {
    const forged = jwt.sign({ userId: USER_ID }, "some-other-secret");
    expect(() => verifyTokenForRefresh(forged)).toThrow();
  });

  it("rejects an expired token that has no userId claim", () => {
    const noUser = jwt.sign({ exp: nowSec() - 60 }, SECRET);
    expect(() => verifyTokenForRefresh(noUser)).toThrow();
  });
});

describe("verifyTokenForRefresh — leeway env hardening", () => {
  it("falls back to the default window when JWT_REFRESH_LEEWAY_DAYS is non-numeric (not NaN)", async () => {
    // A garbage value must NOT silently disable the cap (NaN comparisons are
    // always false, which would let arbitrarily-old tokens refresh forever).
    vi.resetModules();
    process.env.JWT_REFRESH_LEEWAY_DAYS = "30d"; // Number("30d") === NaN
    const mod = await import("./jwt.js");
    const ancient = jwt.sign(
      { userId: USER_ID, exp: nowSec() - 365 * 24 * 60 * 60 },
      SECRET,
    );
    expect(() => mod.verifyTokenForRefresh(ancient)).toThrow();
    process.env.JWT_REFRESH_LEEWAY_DAYS = "30";
  });
});

describe("登录用量会话", () => {
  it("相同秒内登录也有独立会话，刷新保留原会话", () => {
    const first = signToken(USER_ID),
      second = signToken(USER_ID);
    expect(verifyToken(first).sessionId).not.toBe(
      verifyToken(second).sessionId,
    );
    const payload = verifyTokenForRefresh(first);
    expect(
      verifyToken(signToken(payload.userId, payload.sessionId)).sessionId,
    ).toBe(payload.sessionId);
  });
});
