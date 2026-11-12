import { PublicUnitSchema } from "@cartogo/contracts";
import type { AdminDataRepository } from "./admin-api.js";
import type { PublicDataRepository } from "./public-data.js";

type FleetChangeAction = "add" | "update" | "delete";

type FleetRow = {
  id: number;
  document: unknown;
};

function isFleetRow(value: unknown): value is FleetRow {
  return typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "number" &&
    "document" in value;
}

export type SupabaseFleetRepository = Pick<PublicDataRepository, "listPublicUnits"> & {
  listUnits(): Promise<unknown[]>;
  applyUnitChange(action: FleetChangeAction, unit: Record<string, unknown>): Promise<unknown>;
};

type SupabaseFleetConfig = {
  supabaseUrl?: string;
  serviceRoleKey?: string;
  fetcher?: typeof fetch;
};

export function createSupabaseFleetRepository(
  config: SupabaseFleetConfig,
): SupabaseFleetRepository {
  async function request(path: string, init?: RequestInit): Promise<Response> {
    const supabaseUrl = config.supabaseUrl?.trim().replace(/\/+$/, "");
    const serviceRoleKey = config.serviceRoleKey?.trim();
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Supabase fleet storage is not configured on the API.");
    }

    let response: Response;
    try {
      response = await (config.fetcher ?? fetch)(`${supabaseUrl}/rest/v1/${path}`, {
        ...init,
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
          ...init?.headers,
        },
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      throw new Error("Supabase fleet storage is temporarily unavailable.");
    }

    if (!response.ok) {
      if (response.status === 404) throw new Error("That unit no longer exists.");
      console.error("Supabase fleet request failed.", { status: response.status });
      throw new Error("Supabase fleet storage could not complete the request.");
    }
    return response;
  }

  async function rows(): Promise<FleetRow[]> {
    const response = await request("fleet_documents?select=id,document&order=id.asc");
    const value: unknown = await response.json();
    if (
      !Array.isArray(value) ||
      !value.every(isFleetRow)
    ) {
      throw new Error("Supabase returned invalid fleet data.");
    }
    return value;
  }

  return {
    async listUnits() {
      return (await rows()).map((row) => row.document);
    },
    async listPublicUnits() {
      return (await rows())
        .map((row) => row.document)
        .filter((document) =>
          typeof document === "object" &&
          document !== null &&
          (!("status" in document) || document.status !== "Inactive"),
        );
    },
    async applyUnitChange(action, unit) {
      const id = unit.id;
      if (action === "add") {
        const response = await request("fleet_documents", {
          method: "POST",
          body: JSON.stringify({ document: unit }),
        });
        const created: unknown = await response.json();
        if (!Array.isArray(created) || !created[0] || typeof created[0] !== "object") {
          throw new Error("Supabase did not return the created fleet unit.");
        }
        const document = (created[0] as FleetRow).document;
        return PublicUnitSchema.parse(document);
      }

      if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1) {
        throw new Error("A valid unit ID is required.");
      }
      if (action === "delete") {
        const response = await request(`fleet_documents?id=eq.${id}`, { method: "DELETE" });
        const deleted: unknown = await response.json();
        if (!Array.isArray(deleted) || deleted.length === 0) {
          throw new Error("That unit no longer exists.");
        }
        return { id };
      }

      const response = await request(`fleet_documents?id=eq.${id}`, {
        method: "PATCH",
        body: JSON.stringify({ document: unit }),
      });
      const updated: unknown = await response.json();
      if (!Array.isArray(updated) || !updated[0] || typeof updated[0] !== "object") {
        throw new Error("That unit no longer exists.");
      }
      return PublicUnitSchema.parse((updated[0] as FleetRow).document);
    },
  };
}

export function withSupabaseFleetForAdmin(
  repository: AdminDataRepository,
  fleetRepository: SupabaseFleetRepository,
): AdminDataRepository {
  return {
    ...repository,
    listUnits: fleetRepository.listUnits,
    applyUnitChange: fleetRepository.applyUnitChange,
  };
}
