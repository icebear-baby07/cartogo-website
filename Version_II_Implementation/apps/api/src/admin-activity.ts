export type AdminActivityEvent = {
  actorId: string;
  actorEmail: string;
  action: string;
  resource: string;
  resourceId?: string;
  details?: Record<string, string | number | boolean | null>;
};

export type AdminActivityLogger = (event: AdminActivityEvent) => Promise<void>;

export class AdminActivityLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminActivityLogError";
  }
}

export function createAdminActivityLogger(
  options: {
    supabaseUrl?: string;
    serviceRoleKey?: string;
    fetcher?: typeof fetch;
  },
): AdminActivityLogger {
  return async (event) => {
    const supabaseUrl = options.supabaseUrl?.trim().replace(/\/+$/, "");
    const serviceRoleKey = options.serviceRoleKey?.trim();
    if (!supabaseUrl || !serviceRoleKey) {
      throw new AdminActivityLogError("Supabase admin activity logging is not configured on the API.");
    }

    let response: Response;
    try {
      response = await (options.fetcher ?? fetch)(
        `${supabaseUrl}/rest/v1/admin_activity_logs`,
        {
          method: "POST",
          headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({
            actor_id: event.actorId,
            actor_email: event.actorEmail,
            action: event.action,
            resource: event.resource,
            resource_id: event.resourceId ?? null,
            details: event.details ?? {},
          }),
          signal: AbortSignal.timeout(8_000),
        },
      );
    } catch {
      throw new AdminActivityLogError("Supabase could not save the admin activity log.");
    }

    if (!response.ok) {
      throw new AdminActivityLogError(
        `Supabase could not save the admin activity log (HTTP ${response.status}).`,
      );
    }
  };
}
