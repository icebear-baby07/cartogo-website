import type { AdminDataRepository } from "./admin-api.js";
import type { BookingRepository } from "./booking.js";

type Inquiry = Record<string, unknown> & { id: number; email: string };
type VehicleDemand = {
  vehicle_id: string;
  vehicle_name: string;
  inquiry_count: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInquiry(value: unknown): value is Inquiry {
  return isRecord(value) &&
    typeof value.id === "number" &&
    Number.isSafeInteger(value.id) &&
    value.id > 0 &&
    typeof value.email === "string";
}

function isVehicleDemand(value: unknown): value is VehicleDemand {
  return isRecord(value) &&
    typeof value.vehicle_id === "string" &&
    typeof value.vehicle_name === "string" &&
    typeof value.inquiry_count === "number" &&
    Number.isSafeInteger(value.inquiry_count) &&
    value.inquiry_count >= 0;
}

type SupabaseInquiriesConfig = {
  supabaseUrl?: string;
  serviceRoleKey?: string;
  fetcher?: typeof fetch;
};

export type SupabaseInquiriesRepository = Pick<
  AdminDataRepository,
  | "listInquiries"
  | "listVehicleDemand"
  | "updateInquiryStatus"
  | "restoreInquiry"
  | "rejectInquiry"
  | "getInquiry"
  | "markInquiryRejectionEmailSent"
  | "deleteInquiry"
> & Pick<BookingRepository, "findInquiryByRequestId" | "addInquiry">;

export function createSupabaseInquiriesRepository(
  config: SupabaseInquiriesConfig,
): SupabaseInquiriesRepository {
  async function request(path: string, init?: RequestInit): Promise<Response> {
    const supabaseUrl = config.supabaseUrl?.trim().replace(/\/+$/, "");
    const serviceRoleKey = config.serviceRoleKey?.trim();
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Supabase inquiry storage is not configured on the API.");
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
      throw new Error("Supabase inquiry storage is temporarily unavailable.");
    }
    if (!response.ok) {
      console.error("Supabase inquiry request failed.", { status: response.status, path });
      throw new Error("Supabase inquiry storage could not complete the request.");
    }
    return response;
  }

  async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
    const response = await request(`rpc/${name}`, {
      method: "POST",
      body: JSON.stringify(args),
    });
    return response.json();
  }

  async function rows(path: string): Promise<unknown[]> {
    const response = await request(path);
    const value: unknown = await response.json();
    if (!Array.isArray(value)) throw new Error("Supabase returned invalid inquiry data.");
    return value;
  }

  async function readInquiryByRequestId(requestId: string): Promise<Inquiry | null> {
    const value = await rows(
      `inquiry_documents?select=document&client_request_id=eq.${encodeURIComponent(requestId)}&limit=1`,
    );
    if (value.length === 0) return null;
    if (!isRecord(value[0]) || !isInquiry(value[0].document)) {
      throw new Error("Supabase returned invalid inquiry data.");
    }
    const { client_request_id: _requestId, ...inquiry } = value[0].document;
    return inquiry;
  }

  async function readInquiry(id: number): Promise<Record<string, unknown> | null> {
    const value = await rpc("get_inquiry_document", { p_id: id });
    if (value === null) return null;
    if (!isRecord(value)) throw new Error("Supabase returned invalid inquiry data.");
    return value;
  }

  async function updateInquiry(id: number, status: string): Promise<unknown> {
    const value = await rpc("update_inquiry_status", { p_id: id, p_status: status });
    if (!isRecord(value)) throw new Error("That inquiry no longer exists.");
    return value;
  }

  async function listInquiries(): Promise<unknown[]> {
    const value = await rpc("get_inquiry_documents", {});
    if (!Array.isArray(value)) throw new Error("Supabase returned invalid inquiry data.");
    return value.map((row) => {
      if (!isRecord(row)) {
        throw new Error("Supabase returned invalid inquiry data.");
      }
      return row;
    });
  }

  return {
    async findInquiryByRequestId(requestId) {
      return readInquiryByRequestId(requestId);
    },
    async addInquiry(inquiry, requestId) {
      if (typeof inquiry.email !== "string") {
        throw new Error("A valid inquiry email is required.");
      }
      const now = new Date().toISOString();
      const value = await rpc("create_inquiry_document", {
        p_client_request_id: requestId,
        p_document: {
          ...inquiry,
          created_at: now,
          verified_at: now,
        },
      });
      if (!isInquiry(value)) throw new Error("Supabase did not return the saved inquiry.");
      const { client_request_id: _requestId, ...result } = value;
      return result;
    },
    async listInquiries() {
      return listInquiries();
    },
    async listVehicleDemand() {
      const value = await rpc("get_inquiry_vehicle_demand", {});
      if (!Array.isArray(value) || !value.every(isVehicleDemand)) {
        throw new Error("Supabase returned invalid inquiry demand analytics.");
      }
      return value;
    },
    async updateInquiryStatus(id, status) {
      return updateInquiry(id, status);
    },
    async restoreInquiry(id) {
      const value = await rpc("restore_inquiry", { p_id: id });
      if (isRecord(value)) return value;
      if (!await readInquiry(id)) throw new Error("That inquiry no longer exists.");
      throw new Error("Only rejected inquiries can be restored.");
    },
    async rejectInquiry(id, reason) {
      const value = await rpc("reject_inquiry", { p_id: id, p_reason: reason });
      if (isRecord(value)) return value;
      if (!await readInquiry(id)) throw new Error("That inquiry no longer exists.");
      throw new Error("This inquiry has already been rejected.");
    },
    async getInquiry(id) {
      return readInquiry(id);
    },
    async markInquiryRejectionEmailSent(id) {
      const value = await rpc("mark_inquiry_rejection_email_sent", { p_id: id });
      if (!isRecord(value)) throw new Error("The rejected inquiry no longer exists.");
      return value;
    },
    async deleteInquiry(id) {
      const value = await rpc("delete_inquiry", { p_id: id });
      if (!isRecord(value) || value.id !== id) {
        throw new Error("That inquiry no longer exists.");
      }
      return value;
    },
  };
}

export function withSupabaseInquiriesForAdmin(
  repository: AdminDataRepository,
  inquiries: SupabaseInquiriesRepository,
): AdminDataRepository {
  return {
    ...repository,
    listInquiries: inquiries.listInquiries,
    listVehicleDemand: inquiries.listVehicleDemand,
    updateInquiryStatus: inquiries.updateInquiryStatus,
    restoreInquiry: inquiries.restoreInquiry,
    rejectInquiry: inquiries.rejectInquiry,
    getInquiry: inquiries.getInquiry,
    markInquiryRejectionEmailSent: inquiries.markInquiryRejectionEmailSent,
    deleteInquiry: inquiries.deleteInquiry,
  };
}

export function withSupabaseInquiriesForBooking(
  repository: BookingRepository,
  inquiries: SupabaseInquiriesRepository,
): BookingRepository {
  return {
    ...repository,
    findInquiryByRequestId: inquiries.findInquiryByRequestId,
    addInquiry: inquiries.addInquiry,
  };
}
