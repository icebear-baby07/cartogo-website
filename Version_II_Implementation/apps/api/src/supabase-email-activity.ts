import { randomUUID } from "node:crypto";
import type { AdminDataRepository } from "./admin-api.js";
import type {
  EmailActivityAction,
  EmailActivityRecorder,
  EmailActivityType,
} from "./email-activity.js";

type EmailActivityRow = {
  timestamp: string;
  email_type: EmailActivityType;
  activity: EmailActivityAction;
  count: number;
};

const emailActivityTypes = new Set<EmailActivityType>([
  "email_verification",
  "inquiry_confirmation",
  "inquiry_rejection",
  "owner_approval",
]);
const emailActivityActions = new Set<EmailActivityAction>([
  "queued",
  "attempted",
  "sent",
  "failed",
]);

function isEmailActivityRow(value: unknown): value is EmailActivityRow {
  if (typeof value !== "object" || value === null) return false;
  return "timestamp" in value &&
    typeof value.timestamp === "string" &&
    Number.isFinite(Date.parse(value.timestamp)) &&
    "email_type" in value &&
    typeof value.email_type === "string" &&
    emailActivityTypes.has(value.email_type as EmailActivityType) &&
    "activity" in value &&
    typeof value.activity === "string" &&
    emailActivityActions.has(value.activity as EmailActivityAction) &&
    "count" in value &&
    typeof value.count === "number" &&
    Number.isSafeInteger(value.count) &&
    value.count >= 0;
}

type SupabaseEmailActivityConfig = {
  supabaseUrl?: string;
  serviceRoleKey?: string;
  fetcher?: typeof fetch;
};

export type SupabaseEmailActivityRepository = {
  recordEmailActivity: EmailActivityRecorder;
  listEmailActivities: AdminDataRepository["listEmailActivities"];
};

export function createSupabaseEmailActivityRepository(
  config: SupabaseEmailActivityConfig,
): SupabaseEmailActivityRepository {
  async function request(path: string, init?: RequestInit): Promise<Response> {
    const supabaseUrl = config.supabaseUrl?.trim().replace(/\/+$/, "");
    const serviceRoleKey = config.serviceRoleKey?.trim();
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Supabase email activity storage is not configured on the API.");
    }

    let response: Response;
    try {
      response = await (config.fetcher ?? fetch)(`${supabaseUrl}/rest/v1/${path}`, {
        ...init,
        headers: {
          apikey: serviceRoleKey,
          Authorization: `******`,
          "Content-Type": "application/json",
          ...init?.headers,
        },
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      throw new Error("Supabase email activity storage is temporarily unavailable.");
    }
    if (!response.ok) {
      console.error("Supabase email activity request failed.", { status: response.status });
      throw new Error("Supabase email activity storage could not complete the request.");
    }
    return response;
  }

  return {
    async recordEmailActivity(emailType, activity) {
      await request("email_activity_logs", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          source_id: randomUUID(),
          email_type: emailType,
          activity,
          occurred_at: new Date().toISOString(),
        }),
      });
    },
    async listEmailActivities(start, end, bucketMinutes) {
      const response = await request("rpc/get_email_activity_analytics", {
        method: "POST",
        body: JSON.stringify({
          p_start: start.toISOString(),
          p_end: end.toISOString(),
          p_bucket_minutes: bucketMinutes,
        }),
      });
      const value: unknown = await response.json();
      if (!Array.isArray(value) || !value.every(isEmailActivityRow)) {
        throw new Error("Supabase returned invalid email activity analytics.");
      }
      return value.map(({ timestamp, ...row }) => ({
        ...row,
        timestamp: new Date(timestamp),
      }));
    },
  };
}

export function withSupabaseEmailActivitiesForAdmin(
  repository: AdminDataRepository,
  emailActivities: SupabaseEmailActivityRepository,
): AdminDataRepository {
  return {
    ...repository,
    listEmailActivities: emailActivities.listEmailActivities,
  };
}
