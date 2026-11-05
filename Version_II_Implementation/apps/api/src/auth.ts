import { Router, type RequestHandler } from "express";

export type AuthenticatedAdmin = {
  id: string;
  email: string;
};

type SupabaseAuthConfig = {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
};

type AuthErrorStatus = 401 | 403 | 503;

export class AuthError extends Error {
  constructor(
    public readonly status: AuthErrorStatus,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

declare global {
  namespace Express {
    interface Request {
      authenticatedAdmin?: AuthenticatedAdmin;
    }
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new AuthError(503, "The identity provider returned an invalid response.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function verifyAdminToken(
  accessToken: string,
  config: SupabaseAuthConfig,
  fetcher: typeof fetch = fetch,
): Promise<AuthenticatedAdmin> {
  const supabaseUrl = config.supabaseUrl?.trim().replace(/\/+$/, "");
  const anonKey = config.supabaseAnonKey?.trim();
  if (!supabaseUrl || !anonKey) {
    throw new AuthError(503, "Supabase authentication is not configured on the API.");
  }

  const headers = {
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
  };
  const requestOptions = { headers, signal: AbortSignal.timeout(8000) };
  let userResponse: Response;
  try {
    userResponse = await fetcher(`${supabaseUrl}/auth/v1/user`, requestOptions);
  } catch {
    throw new AuthError(503, "The identity provider is temporarily unavailable.");
  }
  if (userResponse.status === 401 || userResponse.status === 403) {
    throw new AuthError(401, "Your sign-in has expired. Sign in again to continue.");
  }
  if (!userResponse.ok) {
    throw new AuthError(503, "The identity provider could not verify your account.");
  }

  const user = await readJson(userResponse);
  if (
    !isRecord(user) ||
    typeof user.id !== "string" ||
    !user.id ||
    typeof user.email !== "string" ||
    !user.email.trim()
  ) {
    throw new AuthError(401, "The signed-in account could not be verified.");
  }

  let adminResponse: Response;
  try {
    adminResponse = await fetcher(
      `${supabaseUrl}/rest/v1/rpc/is_cartogo_admin`,
      {
        ...requestOptions,
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: "{}",
      },
    );
  } catch {
    throw new AuthError(503, "Administrator access could not be verified.");
  }
  if (adminResponse.status === 401 || adminResponse.status === 403) {
    throw new AuthError(401, "Your sign-in has expired. Sign in again to continue.");
  }
  if (!adminResponse.ok) {
    throw new AuthError(503, "Administrator access could not be verified.");
  }

  const isAdmin = await readJson(adminResponse);
  if (isAdmin !== true) {
    throw new AuthError(403, "This Google account is not authorized to access the admin tools.");
  }

  return { id: user.id, email: user.email.trim().toLowerCase() };
}

export function createRequireAdmin(config: SupabaseAuthConfig): RequestHandler {
  return (request, response, next) => {
    const authorization = request.get("authorization") ?? "";
    const tokenMatch = /^Bearer\s+(\S+)$/i.exec(authorization);
    if (!tokenMatch) {
      response.status(401).json({ error: "Sign in to continue." });
      return;
    }

    void verifyAdminToken(tokenMatch[1], config)
      .then((admin) => {
        request.authenticatedAdmin = admin;
        next();
      })
      .catch((error: unknown) => {
        if (error instanceof AuthError) {
          response.status(error.status).json({ error: error.message });
          return;
        }
        console.error(
          "Supabase administrator verification failed.",
          error instanceof Error ? error.message : String(error),
        );
        response.status(503).json({ error: "Administrator access could not be verified." });
      });
  };
}

export function createAuthRouter(config: SupabaseAuthConfig): Router {
  const router = Router();
  router.get("/auth/me", createRequireAdmin(config), (request, response) => {
    response.json(request.authenticatedAdmin);
  });
  return router;
}
