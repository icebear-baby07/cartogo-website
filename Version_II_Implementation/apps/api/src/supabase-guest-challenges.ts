import type { BookingRepository, GuestChallenge } from "./booking.js";

type GuestChallengeRow = {
  id: string;
  email: string;
  ip_hash: string;
  code_hash: string;
  expires_at: string;
  created_at: string;
  attempts: number;
  verified_at: string | null;
  token_hash: string | null;
  consumed_at: string | null;
};

type SupabaseGuestChallengesConfig = {
  supabaseUrl?: string;
  serviceRoleKey?: string;
  fetcher?: typeof fetch;
};

export type SupabaseGuestChallengesRepository = Pick<
  BookingRepository,
  | "createGuestChallenge"
  | "getGuestChallenge"
  | "incrementGuestChallengeAttempts"
  | "saveGuestChallengeVerification"
  | "deleteGuestChallenge"
  | "consumeGuestChallenge"
  | "releaseGuestChallenge"
>;

function isGuestChallengeRow(value: unknown): value is GuestChallengeRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" &&
    typeof row.email === "string" &&
    typeof row.ip_hash === "string" &&
    typeof row.code_hash === "string" &&
    typeof row.expires_at === "string" &&
    Number.isFinite(Date.parse(row.expires_at)) &&
    typeof row.created_at === "string" &&
    Number.isFinite(Date.parse(row.created_at)) &&
    typeof row.attempts === "number" &&
    Number.isSafeInteger(row.attempts) &&
    row.attempts >= 0 &&
    (row.verified_at === null ||
      typeof row.verified_at === "string" && Number.isFinite(Date.parse(row.verified_at))) &&
    (row.token_hash === null || typeof row.token_hash === "string") &&
    (row.consumed_at === null ||
      typeof row.consumed_at === "string" && Number.isFinite(Date.parse(row.consumed_at)));
}

function toGuestChallenge(row: GuestChallengeRow): GuestChallenge & { consumed_at?: Date } {
  return {
    id: row.id,
    email: row.email,
    ip_hash: row.ip_hash,
    code_hash: row.code_hash,
    expires_at: new Date(row.expires_at),
    created_at: new Date(row.created_at),
    attempts: row.attempts,
    ...(row.verified_at === null ? {} : { verified_at: new Date(row.verified_at) }),
    ...(row.token_hash === null ? {} : { token_hash: row.token_hash }),
    ...(row.consumed_at === null ? {} : { consumed_at: new Date(row.consumed_at) }),
  };
}

export function createSupabaseGuestChallengesRepository(
  config: SupabaseGuestChallengesConfig,
): SupabaseGuestChallengesRepository {
  async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
    const supabaseUrl = config.supabaseUrl?.trim().replace(/\/+$/, "");
    const serviceRoleKey = config.serviceRoleKey?.trim();
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Supabase guest verification storage is not configured on the API.");
    }

    let response: Response;
    try {
      response = await (config.fetcher ?? fetch)(`${supabaseUrl}/rest/v1/rpc/${name}`, {
        method: "POST",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `******`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      throw new Error("Supabase guest verification storage is temporarily unavailable.");
    }
    if (!response.ok) {
      console.error("Supabase guest verification request failed.", { status: response.status, rpc: name });
      throw new Error("Supabase guest verification storage could not complete the request.");
    }
    return response.json();
  }

  return {
    async createGuestChallenge(challenge) {
      const created = await rpc("create_guest_email_challenge", {
        p_id: challenge.id,
        p_email: challenge.email,
        p_ip_hash: challenge.ip_hash,
        p_code_hash: challenge.code_hash,
        p_expires_at: challenge.expires_at.toISOString(),
        p_created_at: challenge.created_at.toISOString(),
      });
      if (created !== true) throw new Error("rate_limited");
    },
    async getGuestChallenge(id) {
      const response = await (async () => {
        const supabaseUrl = config.supabaseUrl?.trim().replace(/\/+$/, "");
        const serviceRoleKey = config.serviceRoleKey?.trim();
        if (!supabaseUrl || !serviceRoleKey) {
          throw new Error("Supabase guest verification storage is not configured on the API.");
        }
        try {
          return await (config.fetcher ?? fetch)(
            `${supabaseUrl}/rest/v1/guest_email_challenges?id=eq.${encodeURIComponent(id)}&select=id,email,ip_hash,code_hash,expires_at,created_at,attempts,verified_at,token_hash,consumed_at&limit=1`,
            {
              headers: {
                apikey: serviceRoleKey,
                Authorization: `******`,
              },
              signal: AbortSignal.timeout(8_000),
            },
          );
        } catch {
          throw new Error("Supabase guest verification storage is temporarily unavailable.");
        }
      })();
      if (!response.ok) {
        console.error("Supabase guest verification request failed.", { status: response.status });
        throw new Error("Supabase guest verification storage could not complete the request.");
      }
      const value: unknown = await response.json();
      if (!Array.isArray(value) || !value.every(isGuestChallengeRow)) {
        throw new Error("Supabase returned invalid guest verification data.");
      }
      return value[0] ? toGuestChallenge(value[0]) : null;
    },
    async incrementGuestChallengeAttempts(id, now) {
      const attempts = await rpc("increment_guest_email_challenge_attempts", {
        p_id: id,
        p_now: now.toISOString(),
      });
      if (attempts === null) return null;
      if (typeof attempts !== "number" || !Number.isSafeInteger(attempts) || attempts < 1) {
        throw new Error("Supabase returned invalid guest verification attempt data.");
      }
      return attempts;
    },
    async saveGuestChallengeVerification(id, tokenHash, now) {
      const saved = await rpc("save_guest_email_challenge_verification", {
        p_id: id,
        p_token_hash: tokenHash,
        p_now: now.toISOString(),
      });
      if (typeof saved !== "boolean") {
        throw new Error("Supabase returned invalid guest verification state.");
      }
      return saved;
    },
    async deleteGuestChallenge(id) {
      const deleted = await rpc("delete_guest_email_challenge", { p_id: id });
      if (typeof deleted !== "boolean") {
        throw new Error("Supabase returned invalid guest verification deletion state.");
      }
    },
    async consumeGuestChallenge(id, email, tokenHash, now) {
      const consumed = await rpc("consume_guest_email_challenge", {
        p_id: id,
        p_email: email,
        p_token_hash: tokenHash,
        p_now: now.toISOString(),
      });
      if (typeof consumed !== "boolean") {
        throw new Error("Supabase returned invalid guest verification consumption state.");
      }
      return consumed;
    },
    async releaseGuestChallenge(id, email, tokenHash) {
      const released = await rpc("release_guest_email_challenge", {
        p_id: id,
        p_email: email,
        p_token_hash: tokenHash,
      });
      if (typeof released !== "boolean") {
        throw new Error("Supabase returned invalid guest verification release state.");
      }
    },
  };
}

export function withSupabaseGuestChallengesForBooking(
  repository: BookingRepository,
  challenges: SupabaseGuestChallengesRepository,
): BookingRepository {
  return {
    ...repository,
    createGuestChallenge: challenges.createGuestChallenge,
    getGuestChallenge: challenges.getGuestChallenge,
    incrementGuestChallengeAttempts: challenges.incrementGuestChallengeAttempts,
    saveGuestChallengeVerification: challenges.saveGuestChallengeVerification,
    deleteGuestChallenge: challenges.deleteGuestChallenge,
    consumeGuestChallenge: challenges.consumeGuestChallenge,
    releaseGuestChallenge: challenges.releaseGuestChallenge,
  };
}
