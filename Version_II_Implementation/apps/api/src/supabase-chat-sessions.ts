import type { AdminDataRepository } from "./admin-api.js";

type SupabaseChatSessionsConfig = {
  supabaseUrl?: string;
  serviceRoleKey?: string;
  fetcher?: typeof fetch;
};

export type SupabaseChatSessionsRepository = Pick<
  AdminDataRepository,
  "listChatSessions" | "deleteChatSession"
>;

function isChatSession(value: unknown): value is Record<string, unknown> & { id: string } {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "id" in value &&
    typeof value.id === "string" &&
    value.id.length > 0;
}

export function createSupabaseChatSessionsRepository(
  config: SupabaseChatSessionsConfig,
): SupabaseChatSessionsRepository {
  async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
    const supabaseUrl = config.supabaseUrl?.trim().replace(/\/+$/, "");
    const serviceRoleKey = config.serviceRoleKey?.trim();
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Supabase chat-session storage is not configured on the API.");
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
      throw new Error("Supabase chat-session storage is temporarily unavailable.");
    }
    if (!response.ok) {
      console.error("Supabase chat-session request failed.", { status: response.status, rpc: name });
      throw new Error("Supabase chat-session storage could not complete the request.");
    }
    return response.json();
  }

  return {
    async listChatSessions() {
      const value = await rpc("list_cartogo_chat_sessions", {});
      if (!Array.isArray(value) || !value.every(isChatSession)) {
        throw new Error("Supabase returned invalid chat-session data.");
      }
      return value;
    },
    async deleteChatSession(id) {
      const value = await rpc("delete_cartogo_chat_session", { p_id: id });
      if (!isChatSession(value)) {
        throw new Error("That chat session no longer exists.");
      }
      return value;
    },
  };
}

export function withSupabaseChatSessionsForAdmin(
  repository: AdminDataRepository,
  sessions: SupabaseChatSessionsRepository,
): AdminDataRepository {
  return {
    ...repository,
    listChatSessions: sessions.listChatSessions,
    deleteChatSession: sessions.deleteChatSession,
  };
}
