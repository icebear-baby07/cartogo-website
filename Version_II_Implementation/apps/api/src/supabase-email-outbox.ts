import type { BookingRepository, EmailOutboxItem } from "./booking.js";
import {
  recordEmailActivitySafely,
  type EmailActivityRecorder,
} from "./email-activity.js";

type SupabaseEmailOutboxConfig = {
  supabaseUrl?: string;
  serviceRoleKey?: string;
  recordEmailActivity?: EmailActivityRecorder;
  fetcher?: typeof fetch;
};

export type SupabaseEmailOutboxRepository = Pick<
  BookingRepository,
  | "enqueueInquiryConfirmation"
  | "claimInquiryConfirmation"
  | "completeInquiryConfirmation"
  | "retryInquiryConfirmation"
>;

function isOutboxItem(value: unknown): value is EmailOutboxItem {
  return typeof value === "object" &&
    value !== null &&
    "_id" in value &&
    typeof value._id === "string" &&
    "attempts" in value &&
    typeof value.attempts === "number" &&
    Number.isSafeInteger(value.attempts) &&
    "inquiry" in value &&
    typeof value.inquiry === "object" &&
    value.inquiry !== null &&
    "email" in value.inquiry &&
    typeof value.inquiry.email === "string" &&
    "id" in value.inquiry &&
    typeof value.inquiry.id === "number";
}

export function createSupabaseEmailOutboxRepository(
  config: SupabaseEmailOutboxConfig,
): SupabaseEmailOutboxRepository {
  async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
    const supabaseUrl = config.supabaseUrl?.trim().replace(/\/+$/, "");
    const serviceRoleKey = config.serviceRoleKey?.trim();
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Supabase email outbox storage is not configured on the API.");
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
      throw new Error("Supabase email outbox storage is temporarily unavailable.");
    }
    if (!response.ok) {
      console.error("Supabase email outbox request failed.", { status: response.status, rpc: name });
      throw new Error("Supabase email outbox storage could not complete the request.");
    }
    return response.json();
  }

  return {
    async enqueueInquiryConfirmation(inquiry) {
      const inserted = await rpc("enqueue_inquiry_confirmation", {
        p_inquiry: inquiry,
      });
      if (typeof inserted !== "boolean") {
        throw new Error("Supabase returned an invalid email outbox result.");
      }
      if (inserted) {
        await recordEmailActivitySafely(
          config.recordEmailActivity,
          "inquiry_confirmation",
          "queued",
        );
      }
    },
    async claimInquiryConfirmation(now) {
      const value = await rpc("claim_inquiry_confirmation", { p_now: now.toISOString() });
      if (value === null) return null;
      if (!isOutboxItem(value)) throw new Error("Supabase returned an invalid email outbox item.");
      return value;
    },
    async completeInquiryConfirmation(id, now) {
      const updated = await rpc("complete_inquiry_confirmation", {
        p_id: id,
        p_now: now.toISOString(),
      });
      if (updated !== true) throw new Error("The claimed inquiry email could not be marked as sent.");
    },
    async retryInquiryConfirmation(id, attempts, error, now) {
      const updated = await rpc("retry_inquiry_confirmation", {
        p_id: id,
        p_attempts: attempts,
        p_error: error.slice(0, 500),
        p_now: now.toISOString(),
      });
      if (updated !== true) throw new Error("The inquiry email retry state could not be saved.");
    },
  };
}

export function withSupabaseEmailOutboxForBooking(
  repository: BookingRepository,
  outbox: SupabaseEmailOutboxRepository,
): BookingRepository {
  return {
    ...repository,
    enqueueInquiryConfirmation: outbox.enqueueInquiryConfirmation,
    claimInquiryConfirmation: outbox.claimInquiryConfirmation,
    completeInquiryConfirmation: outbox.completeInquiryConfirmation,
    retryInquiryConfirmation: outbox.retryInquiryConfirmation,
  };
}
