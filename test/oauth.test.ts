import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAuthUrl,
  codeChallenge,
  createPendingAuth,
  exchangeCode,
  isPendingAuthUsable,
  OAuthError,
  PENDING_AUTH_TTL_MS,
  parseAuthResponse,
  refreshAccessToken,
  SCOPE,
  TOKEN_ENDPOINT,
} from "../src/oauth.ts";

function fakeFetch(status: number, body: unknown, calls: Array<{ url: string; body: URLSearchParams }>): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body as URLSearchParams });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

describe("PKCE", () => {
  it("matches the RFC 7636 appendix B example", async () => {
    assert.equal(
      await codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("builds an auth URL with loopback redirect, S256 challenge and offline access", async () => {
    const pending = createPendingAuth(0);
    const url = new URL(await buildAuthUrl("cid.apps.googleusercontent.com", pending));
    assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.equal(url.searchParams.get("scope"), SCOPE);
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("code_challenge"), await codeChallenge(pending.verifier));
    assert.equal(url.searchParams.get("access_type"), "offline");
    assert.equal(url.searchParams.get("state"), pending.state);
    assert.match(url.searchParams.get("redirect_uri") ?? "", /^http:\/\/127\.0\.0\.1:\d{5}\/$/);
  });
});

describe("parseAuthResponse", () => {
  it("reads code and state from the redirect address", () => {
    assert.deepEqual(parseAuthResponse("  http://127.0.0.1:51234/?state=abc&code=4/0AbC-d_e&scope=x  "), {
      kind: "code",
      code: "4/0AbC-d_e",
      state: "abc",
    });
  });

  it("reports an error redirect", () => {
    assert.deepEqual(parseAuthResponse("http://127.0.0.1:51234/?error=access_denied&state=abc"), {
      kind: "error",
      error: "access_denied",
    });
  });

  it("accepts a bare code but rejects junk", () => {
    assert.deepEqual(parseAuthResponse("4/0AbCdEfGhIjK"), { kind: "code", code: "4/0AbCdEfGhIjK", state: null });
    assert.equal(parseAuthResponse("").kind, "invalid");
    assert.equal(parseAuthResponse("hello world").kind, "invalid");
    assert.equal(parseAuthResponse("http://127.0.0.1:51234/?state=abc").kind, "invalid");
  });
});

describe("isPendingAuthUsable", () => {
  it("expires pending sign-ins", () => {
    const pending = createPendingAuth(1_000);
    assert.ok(isPendingAuthUsable(pending, 1_000 + PENDING_AUTH_TTL_MS - 1));
    assert.ok(!isPendingAuthUsable(pending, 1_000 + PENDING_AUTH_TTL_MS));
    assert.ok(!isPendingAuthUsable(null, 0));
  });
});

describe("token endpoint", () => {
  it("exchanges a code with the verifier and redirect it was issued for", async () => {
    const calls: Array<{ url: string; body: URLSearchParams }> = [];
    const pending = createPendingAuth(0);
    const tokens = await exchangeCode(
      { clientId: "cid", clientSecret: "sec", code: "4/abc", pending, now: 1_000 },
      fakeFetch(200, { access_token: "at", refresh_token: "rt", expires_in: 3599 }, calls),
    );
    assert.deepEqual(tokens, { accessToken: "at", refreshToken: "rt", expiresAt: 1_000 + 3_599_000 });
    assert.equal(calls[0].url, TOKEN_ENDPOINT);
    assert.equal(calls[0].body.get("grant_type"), "authorization_code");
    assert.equal(calls[0].body.get("code_verifier"), pending.verifier);
    assert.equal(calls[0].body.get("redirect_uri"), pending.redirectUri);
  });

  it("requires a refresh token on first exchange", async () => {
    await assert.rejects(
      exchangeCode(
        { clientId: "cid", clientSecret: "sec", code: "4/abc", pending: createPendingAuth(0), now: 0 },
        fakeFetch(200, { access_token: "at" }, []),
      ),
      (e: unknown) => e instanceof OAuthError && e.code === "no_refresh_token",
    );
  });

  it("keeps the old refresh token when Google doesn't rotate it", async () => {
    const tokens = await refreshAccessToken(
      { clientId: "cid", clientSecret: "sec", tokens: { accessToken: "old", refreshToken: "rt", expiresAt: 0 }, now: 0 },
      fakeFetch(200, { access_token: "new", expires_in: 3600 }, []),
    );
    assert.equal(tokens.refreshToken, "rt");
    assert.equal(tokens.accessToken, "new");
  });

  it("surfaces invalid_grant so the widget can ask for sign-in again", async () => {
    await assert.rejects(
      refreshAccessToken(
        { clientId: "cid", clientSecret: "sec", tokens: { accessToken: "", refreshToken: "rt", expiresAt: 0 }, now: 0 },
        fakeFetch(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." }, []),
      ),
      (e: unknown) => e instanceof OAuthError && e.code === "invalid_grant",
    );
  });
});
