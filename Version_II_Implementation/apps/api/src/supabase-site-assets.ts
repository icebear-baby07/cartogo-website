import { SiteAssetSchema } from "@cartogo/contracts";
import type { AdminDataRepository } from "./admin-api.js";
import type { PublicDataRepository } from "./public-data.js";

type SiteAssetChangeAction = "add" | "update" | "delete";

type SiteAssetRow = {
  id: number;
  document: unknown;
};

function isSiteAssetRow(value: unknown): value is SiteAssetRow {
  return typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "number" &&
    "document" in value;
}

export type SupabaseSiteAssetRepository = Pick<PublicDataRepository, "listSiteAssets"> & {
  applySiteAssetChange(
    action: SiteAssetChangeAction,
    asset: Record<string, unknown>,
  ): Promise<unknown>;
};

type SupabaseSiteAssetConfig = {
  supabaseUrl?: string;
  serviceRoleKey?: string;
  fetcher?: typeof fetch;
};

export function createSupabaseSiteAssetRepository(
  config: SupabaseSiteAssetConfig,
): SupabaseSiteAssetRepository {
  async function request(path: string, init?: RequestInit): Promise<Response> {
    const supabaseUrl = config.supabaseUrl?.trim().replace(/\/+$/, "");
    const serviceRoleKey = config.serviceRoleKey?.trim();
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Supabase site asset storage is not configured on the API.");
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
      throw new Error("Supabase site asset storage is temporarily unavailable.");
    }

    if (!response.ok) {
      console.error("Supabase site asset request failed.", { status: response.status });
      if (response.status === 404) throw new Error("That site asset no longer exists.");
      if (response.status === 409 || response.status === 23505) {
        throw new Error("A site asset with those details already exists.");
      }
      throw new Error("Supabase site asset storage could not complete the request.");
    }
    return response;
  }

  async function rows(): Promise<SiteAssetRow[]> {
    const response = await request("site_asset_documents?select=id,document&order=id.asc");
    const value: unknown = await response.json();
    if (!Array.isArray(value) || !value.every(isSiteAssetRow)) {
      throw new Error("Supabase returned invalid site asset data.");
    }
    return value;
  }

  return {
    async listSiteAssets() {
      return (await rows()).map((row) => row.document);
    },
    async applySiteAssetChange(action, asset) {
      if (action === "add") {
        const { id: _temporaryId, ...document } = asset;
        const response = await request("site_asset_documents", {
          method: "POST",
          body: JSON.stringify({ document }),
        });
        const created: unknown = await response.json();
        if (!Array.isArray(created) || !created[0] || !isSiteAssetRow(created[0])) {
          throw new Error("Supabase did not return the created site asset.");
        }
        return SiteAssetSchema.parse(created[0].document);
      }

      const id = asset.id;
      if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1) {
        throw new Error("A valid site asset ID is required.");
      }
      if (action === "delete") {
        const response = await request(`site_asset_documents?id=eq.${id}`, {
          method: "DELETE",
        });
        const deleted: unknown = await response.json();
        if (!Array.isArray(deleted) || deleted.length === 0) {
          throw new Error("That site asset no longer exists.");
        }
        return { id };
      }

      const { id: _assetId, ...document } = asset;
      const response = await request(`site_asset_documents?id=eq.${id}`, {
        method: "PATCH",
        body: JSON.stringify({ document }),
      });
      const updated: unknown = await response.json();
      if (!Array.isArray(updated) || !updated[0] || !isSiteAssetRow(updated[0])) {
        throw new Error("That site asset no longer exists.");
      }
      return SiteAssetSchema.parse(updated[0].document);
    },
  };
}

export function withSupabaseSiteAssetsForAdmin(
  repository: AdminDataRepository,
  siteAssets: SupabaseSiteAssetRepository,
): AdminDataRepository {
  return {
    ...repository,
    listSiteAssets: siteAssets.listSiteAssets,
    applySiteAssetChange: siteAssets.applySiteAssetChange,
  };
}
