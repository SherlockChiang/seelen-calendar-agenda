// OAuth 2.0 for installed apps (Google "Desktop app" client) with PKCE.
//
// The widget cannot listen on a loopback port, so the redirect to
// http://127.0.0.1:<port> fails to load in the browser. The user copies that
// address into the widget's "authResponse" setting and we read `code` from it.
// PKCE keeps an intercepted code useless without the verifier we hold.

export const SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

/** Pending sign-in, persisted between "open browser" and "paste redirect". */
export interface PendingAuth {
  verifier: string;
  state: string;
  redirectUri: string;
  createdAt: number;
}

export interface StoredTokens {
  refreshToken: string;
  accessToken: string;
  /** Epoch ms when accessToken expires. */
  expiresAt: number;
}

/** Pending sign-ins older than this are discarded (Google codes expire quickly anyway). */
export const PENDING_AUTH_TTL_MS = 30 * 60 * 1000;

function base64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomToken(byteLength = 32): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

/** Random port in the dynamic range; nothing needs to listen on it. */
export function randomLoopbackRedirect(): string {
  const port = 49152 + Math.floor(Math.random() * (65535 - 49152));
  return `http://127.0.0.1:${port}/`;
}

export function createPendingAuth(now: number): PendingAuth {
  return {
    verifier: randomToken(48),
    state: randomToken(16),
    redirectUri: randomLoopbackRedirect(),
    createdAt: now,
  };
}

export async function buildAuthUrl(clientId: string, pending: PendingAuth): Promise<string> {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: pending.redirectUri,
    response_type: "code",
    scope: SCOPE,
    code_challenge: await codeChallenge(pending.verifier),
    code_challenge_method: "S256",
    state: pending.state,
    access_type: "offline",
    // Forces a refresh token even if the user granted this client before.
    prompt: "consent",
  });
  return `${AUTH_ENDPOINT}?${params}`;
}

export type AuthResponse =
  | { kind: "code"; code: string; state: string | null }
  | { kind: "error"; error: string }
  | { kind: "invalid" };

/**
 * Accepts either the full redirect address (http://127.0.0.1:1234/?state=..&code=..)
 * or a bare authorization code.
 */
export function parseAuthResponse(input: string): AuthResponse {
  const text = input.trim();
  if (!text) return { kind: "invalid" };

  if (/^https?:\/\//i.test(text)) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      return { kind: "invalid" };
    }
    const error = url.searchParams.get("error");
    if (error) return { kind: "error", error };
    const code = url.searchParams.get("code");
    if (!code) return { kind: "invalid" };
    return { kind: "code", code, state: url.searchParams.get("state") };
  }

  // Google codes look like "4/0AbCd..."; reject anything with whitespace or URL syntax.
  if (/^[\w\-/.~]+$/.test(text) && text.length >= 10) {
    return { kind: "code", code: text, state: null };
  }
  return { kind: "invalid" };
}

export function isPendingAuthUsable(pending: PendingAuth | null, now: number): pending is PendingAuth {
  return !!pending && now - pending.createdAt < PENDING_AUTH_TTL_MS;
}

export class OAuthError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "OAuthError";
    this.code = code;
  }
}

interface TokenEndpointResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

async function postToken(body: URLSearchParams, fetchImpl: typeof fetch): Promise<TokenEndpointResponse> {
  // application/x-www-form-urlencoded keeps this a CORS "simple request".
  const res = await fetchImpl(TOKEN_ENDPOINT, { method: "POST", body });
  const json = (await res.json().catch(() => ({}))) as TokenEndpointResponse;
  if (!res.ok || json.error) {
    throw new OAuthError(json.error_description || json.error || `HTTP ${res.status}`, json.error || `http_${res.status}`);
  }
  return json;
}

export async function exchangeCode(
  args: { clientId: string; clientSecret: string; code: string; pending: PendingAuth; now: number },
  fetchImpl: typeof fetch = fetch,
): Promise<StoredTokens> {
  const json = await postToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      code: args.code,
      client_id: args.clientId,
      client_secret: args.clientSecret,
      redirect_uri: args.pending.redirectUri,
      code_verifier: args.pending.verifier,
    }),
    fetchImpl,
  );
  if (!json.access_token || !json.refresh_token) {
    throw new OAuthError("Google did not return a refresh token", "no_refresh_token");
  }
  return {
    refreshToken: json.refresh_token,
    accessToken: json.access_token,
    expiresAt: args.now + (json.expires_in ?? 3600) * 1000,
  };
}

export async function refreshAccessToken(
  args: { clientId: string; clientSecret: string; tokens: StoredTokens; now: number },
  fetchImpl: typeof fetch = fetch,
): Promise<StoredTokens> {
  const json = await postToken(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: args.tokens.refreshToken,
      client_id: args.clientId,
      client_secret: args.clientSecret,
    }),
    fetchImpl,
  );
  if (!json.access_token) throw new OAuthError("Google did not return an access token", "no_access_token");
  return {
    // Google may rotate the refresh token; keep the old one otherwise.
    refreshToken: json.refresh_token || args.tokens.refreshToken,
    accessToken: json.access_token,
    expiresAt: args.now + (json.expires_in ?? 3600) * 1000,
  };
}

export async function revokeToken(token: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  await fetchImpl(REVOKE_ENDPOINT, { method: "POST", body: new URLSearchParams({ token }) }).catch(() => {});
}
