import type { AdminDataRepository, ApprovalChallenge } from "./admin-api.js";

type OwnerApprovalRow = {
  id: string;
  document: Record<string, unknown>;
};

type SupabaseOwnerApprovalsConfig = {
  supabaseUrl?: string;
  serviceRoleKey?: string;
  fetcher?: typeof fetch;
};

export type SupabaseOwnerApprovalsRepository = Pick<
  AdminDataRepository,
  "saveApproval" | "getApproval" | "incrementApprovalAttempts" | "consumeApproval"
>;

const resources = new Set(["unit", "site_assets", "site_content", "chat_sessions"]);
const actions = new Set(["add", "update", "delete"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseApproval(value: unknown): ApprovalChallenge | null {
  if (!isRecord(value)) return null;
  const expiresAt = new Date(String(value.expires_at));
  const createdAt = new Date(String(value.created_at));
  if (
    typeof value.id !== "string" ||
    !resources.has(String(value.resource)) ||
    typeof value.requester_id !== "string" ||
    typeof value.requester_email !== "string" ||
    !Array.isArray(value.owner_emails) ||
    !value.owner_emails.every((email) => typeof email === "string") ||
    !actions.has(String(value.action)) ||
    !isRecord(value.data) ||
    typeof value.code_hash !== "string" ||
    !/^[a-f0-9]{64}$/i.test(value.code_hash) ||
    !Number.isSafeInteger(value.attempts) ||
    Number(value.attempts) < 0 ||
    Number(value.attempts) > 5 ||
    !Number.isFinite(expiresAt.valueOf()) ||
    !Number.isFinite(createdAt.valueOf())
  ) {
    return null;
  }
  return {
    id: value.id,
    resource: value.resource as ApprovalChallenge["resource"],
    requester_id: value.requester_id,
    requester_email: value.requester_email,
    owner_emails: value.owner_emails,
    action: value.action as ApprovalChallenge["action"],
    data: value.data,
    code_hash: value.code_hash,
    expires_at: expiresAt,
    created_at: createdAt,
    attempts: Number(value.attempts),
  };
}

export function createSupabaseOwnerApprovalsRepository(
  config: SupabaseOwnerApprovalsConfig,
): SupabaseOwnerApprovalsRepository {
  async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
    const supabaseUrl = config.supabaseUrl?.trim().replace(/\/+$/, "");
    const serviceRoleKey = config.serviceRoleKey?.trim();
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Supabase owner approval storage is not configured on the API.");
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
      throw new Error("Supabase owner approval storage is temporarily unavailable.");
    }
    if (!response.ok) {
      console.error("Supabase owner approval request failed.", { status: response.status, rpc: name });
      throw new Error("Supabase owner approval storage could not complete the request.");
    }
    return response.json();
  }

  return {
    async saveApproval(challenge) {
      const saved = await rpc("save_owner_approval_challenge", {
        p_id: challenge.id,
        p_document: challenge,
      });
      if (saved !== true) throw new Error("Supabase did not save the owner approval challenge.");
    },
    async getApproval(id) {
      const value = await rpc("get_owner_approval_challenge", { p_id: id });
      if (value === null) return null;
      const challenge = parseApproval(value);
      if (!challenge) throw new Error("Supabase returned invalid owner approval data.");
      return challenge;
    },
    async incrementApprovalAttempts(id) {
      const value = await rpc("increment_owner_approval_attempts", { p_id: id });
      if (value === null) return null;
      if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 5) {
        throw new Error("Supabase returned invalid owner approval attempt data.");
      }
      return Number(value);
    },
    async consumeApproval(id) {
      const value = await rpc("consume_owner_approval_challenge", { p_id: id });
      if (typeof value !== "boolean") {
        throw new Error("Supabase returned invalid owner approval consumption state.");
      }
      return value;
    },
  };
}

export function withSupabaseOwnerApprovalsForAdmin(
  repository: AdminDataRepository,
  approvals: SupabaseOwnerApprovalsRepository,
): AdminDataRepository {
  return {
    ...repository,
    saveApproval: approvals.saveApproval,
    getApproval: approvals.getApproval,
    incrementApprovalAttempts: approvals.incrementApprovalAttempts,
    consumeApproval: approvals.consumeApproval,
  };
}
