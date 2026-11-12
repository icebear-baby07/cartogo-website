import type { AdminDataRepository, AdminRole } from "./admin-api.js";

type SupabaseAdminRolesConfig = {
  supabaseUrl?: string;
  serviceRoleKey?: string;
  initialOwnerEmail?: string;
  fetcher?: typeof fetch;
};

export type SupabaseAdminRolesRepository = Pick<
  AdminDataRepository,
  "getAdminRole" | "hasPermission" | "listOwnerEmails"
>;

function isAdminRole(value: unknown): value is AdminRole {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const role = value as Record<string, unknown>;
  return typeof role.email === "string" &&
    Array.isArray(role.titles) &&
    role.titles.every((title) => typeof title === "string");
}

export function createSupabaseAdminRolesRepository(
  config: SupabaseAdminRolesConfig,
): SupabaseAdminRolesRepository {
  async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
    const supabaseUrl = config.supabaseUrl?.trim().replace(/\/+$/, "");
    const serviceRoleKey = config.serviceRoleKey?.trim();
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Supabase administrator roles are not configured on the API.");
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
      throw new Error("Supabase administrator roles are temporarily unavailable.");
    }
    if (!response.ok) {
      console.error("Supabase administrator role request failed.", { status: response.status, rpc: name });
      throw new Error("Supabase administrator roles could not complete the request.");
    }
    return response.json();
  }

  const roleArguments = (email: string) => ({
    p_email: email.trim().toLowerCase(),
    p_initial_owner_email: config.initialOwnerEmail?.trim().toLowerCase()
      || "remuelfernan07@gmail.com",
  });

  return {
    async getAdminRole(email) {
      const value = await rpc("get_cartogo_admin_role", roleArguments(email));
      if (value === null) return null;
      if (!isAdminRole(value)) throw new Error("Supabase returned invalid administrator role data.");
      return {
        email: value.email.trim().toLowerCase(),
        titles: value.titles,
      };
    },
    async hasPermission(email, permission) {
      const value = await rpc("has_cartogo_admin_permission", {
        ...roleArguments(email),
        p_permission: permission,
      });
      if (typeof value !== "boolean") {
        throw new Error("Supabase returned invalid administrator permission data.");
      }
      return value;
    },
    async listOwnerEmails() {
      const value = await rpc("list_cartogo_owner_emails", {});
      if (!Array.isArray(value) || !value.every((email) => typeof email === "string")) {
        throw new Error("Supabase returned invalid owner account data.");
      }
      return value.map((email) => email.trim().toLowerCase()).filter(Boolean);
    },
  };
}

export function withSupabaseAdminRolesForAdmin(
  repository: AdminDataRepository,
  roles: SupabaseAdminRolesRepository,
): AdminDataRepository {
  return {
    ...repository,
    getAdminRole: roles.getAdminRole,
    hasPermission: roles.hasPermission,
    listOwnerEmails: roles.listOwnerEmails,
  };
}
