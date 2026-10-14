import { createApi, createOpenSunsamaClient, type OpenSunsamaClient } from "@open-sunsama/api-client";
import { isDesktop } from "./desktop";

const baseUrl = import.meta.env.VITE_API_URL || `${window.location.origin}/api`;

/**
 * Desktop fetch wrapper that routes requests through Tauri's HTTP plugin.
 * This bypasses WKWebView CORS restrictions for the tauri:// protocol.
 * The dynamic import is awaited on every call (cached by the module system).
 */
const desktopFetch: typeof globalThis.fetch = async (input, init) => {
  const { fetch } = await import("@tauri-apps/plugin-http");
  return fetch(input, init);
};

// Use Tauri fetch in desktop mode, native fetch otherwise
const customFetch = isDesktop() ? desktopFetch : undefined;

const TOKEN_KEY = "open_sunsama_token";
const USER_KEY = "open_sunsama_user";

function getToken(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return localStorage.getItem(TOKEN_KEY) || undefined;
}

/**
 * Decode the `exp` claim (ms epoch) from a JWT without verifying its
 * signature. Used purely client-side to schedule a proactive refresh before
 * the token lapses. Returns null if the token is malformed or has no expiry.
 */
export function getTokenExpiryMs(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/"))
    ) as { exp?: number };
    return typeof json.exp === "number" ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

// --- Token refresh listeners -------------------------------------------------
// useAuth subscribes so it can mirror a refreshed token into React state (and,
// transitively, reconnect the WebSocket with the new token).
type TokenListener = (token: string) => void;
const tokenListeners = new Set<TokenListener>();

export function onTokenRefreshed(listener: TokenListener): () => void {
  tokenListeners.add(listener);
  return () => {
    tokenListeners.delete(listener);
  };
}

function notifyTokenRefreshed(token: string): void {
  for (const listener of tokenListeners) {
    try {
      listener(token);
    } catch {
      // a misbehaving listener must not break refresh
    }
  }
}

// --- Single-flight token refresh --------------------------------------------
// Concurrent 401s (or a proactive timer firing alongside a request) collapse
// into one refresh call. The refresh request itself goes through a dedicated
// client WITHOUT the onUnauthorized hook, so a failing refresh can't recurse.
let refreshPromise: Promise<string | null> | null = null;

async function performRefresh(): Promise<string | null> {
  const existing = getToken();
  if (!existing) return null;
  try {
    const refreshClient = createApi({ baseUrl, token: existing, customFetch });
    const result = await refreshClient.auth.refreshToken();
    // If the session was torn down (logout) while this refresh was in flight,
    // don't resurrect it by writing a fresh token back.
    if (!getToken()) return null;
    try {
      localStorage.setItem(TOKEN_KEY, result.token);
      localStorage.setItem(USER_KEY, JSON.stringify(result.user));
    } catch {
      // ignore quota errors — the in-memory client is still updated below
    }
    setAuthToken(result.token);
    notifyTokenRefreshed(result.token);
    return result.token;
  } catch {
    return null;
  }
}

/**
 * Obtain a fresh auth token, renewing the stored token and live client.
 * De-duplicates concurrent callers. Resolves with the new token, or null if
 * refresh failed (e.g. the token is expired beyond the server grace window).
 */
export function refreshAuthToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = performRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

function buildApi(token: string | undefined) {
  return createApi({
    baseUrl,
    token,
    customFetch,
    getToken,
    onUnauthorized: refreshAuthToken,
  });
}

function buildClient(token: string | undefined): OpenSunsamaClient {
  return createOpenSunsamaClient({
    baseUrl,
    token,
    customFetch,
    getToken,
    onUnauthorized: refreshAuthToken,
  });
}

// Singleton instances. We keep one client + one api wrapper for the entire
// session and only swap them when the token changes — recreating these on
// every getApi() call (the previous behavior) allocated a fresh ky instance
// per query/mutation, which adds up under heavy use.
let currentToken: string | undefined = getToken();
let client: OpenSunsamaClient = buildClient(currentToken);
let api = buildApi(currentToken);

/**
 * Set the authentication token for API requests.
 * Rebuilds the singleton client+api so all in-flight callers pick up the
 * new auth header on their next request.
 */
export function setAuthToken(token: string | null): void {
  const newToken = token || undefined;
  if (newToken === currentToken) return;
  currentToken = newToken;
  client = buildClient(newToken);
  api = buildApi(newToken);
}

/**
 * Get the current API instance.
 * Cheap — returns the cached singleton. If localStorage was mutated by a
 * non-React path (rare), we sync the token before returning.
 */
export function getApi() {
  const stored = getToken();
  if (stored !== currentToken) {
    setAuthToken(stored ?? null);
  }
  return api;
}

/**
 * Get the API client for making requests (cached singleton).
 */
export function getApiClient() {
  const stored = getToken();
  if (stored !== currentToken) {
    setAuthToken(stored ?? null);
  }
  return client;
}

/**
 * React hook to get the API instance.
 * Returns the typed API wrapper for use in React components/hooks.
 */
export function useApiClient() {
  return getApi();
}

/**
 * Clear the API client (useful for logout).
 */
export function clearApiClient(): void {
  currentToken = undefined;
  client = buildClient(undefined);
  api = buildApi(undefined);
}

export type { OpenSunsamaClient };
