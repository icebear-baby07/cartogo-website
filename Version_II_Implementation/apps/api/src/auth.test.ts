import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { AuthError, createRequireAdmin, verifyAdminToken } from "./auth.js";

const config = {
  supabaseUrl: "https://cartogo.example.supabase.co/",
  supabaseAnonKey: "public-anon-key",
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("verifies the Supabase user and admin allowlist before returning identity", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.endsWith("/auth/v1/user")) {
      return response({ id: "user-1", email: " ADMIN@example.com " });
    }
    return response(true);
  };

  const admin = await verifyAdminToken("valid-token", config, fetcher);

  assert.deepEqual(admin, { id: "user-1", email: "admin@example.com" });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, "https://cartogo.example.supabase.co/auth/v1/user");
  assert.equal(
    new Headers(requests[0].init?.headers).get("Authorization"),
    "Bearer valid-token",
  );
  assert.equal(requests[1].url, "https://cartogo.example.supabase.co/rest/v1/rpc/is_cartogo_admin");
  assert.equal(requests[1].init?.method, "POST");
  assert.equal(requests[1].init?.body, "{}");
});

test("rejects a valid Supabase user that is not in the admin allowlist", async () => {
  const fetcher: typeof fetch = async (input) =>
    String(input).endsWith("/auth/v1/user")
      ? response({ id: "user-1", email: "visitor@example.com" })
      : response(false);

  await assert.rejects(
    verifyAdminToken("valid-token", config, fetcher),
    (error: unknown) =>
      error instanceof AuthError &&
      error.status === 403 &&
      /not authorized/.test(error.message),
  );
});

test("rejects expired tokens and reports missing server configuration", async () => {
  const expiredFetcher: typeof fetch = async () => response({ error: "expired" }, 401);
  await assert.rejects(
    verifyAdminToken("expired-token", config, expiredFetcher),
    (error: unknown) => error instanceof AuthError && error.status === 401,
  );

  await assert.rejects(
    verifyAdminToken("token", {}),
    (error: unknown) => error instanceof AuthError && error.status === 503,
  );
});

test("fails closed when the identity provider returns incomplete user data", async () => {
  const fetcher: typeof fetch = async () => response({ id: "user-1" });
  await assert.rejects(
    verifyAdminToken("token", config, fetcher),
    (error: unknown) => error instanceof AuthError && error.status === 401,
  );
});

test("protects admin routes before handlers run", async () => {
  const app = express();
  app.use("/api/admin", createRequireAdmin({}));
  app.get("/api/admin/private", (_request, res) => res.json({ reached: true }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/admin/private`);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Sign in to continue." });
  } finally {
    server.close();
    await once(server, "close");
  }
});
