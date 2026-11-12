import { SiteContentSchema } from "@cartogo/contracts";
import type { AdminDataRepository } from "./admin-api.js";
import type { BookingRepository } from "./booking.js";
import type { PublicDataRepository } from "./public-data.js";

type SiteContentRow = {
  id: string;
  document: unknown;
};

function isSiteContentRow(value: unknown): value is SiteContentRow {
  return typeof value === "object" &&
    value !== null &&
    "id" in value &&
    value.id === "public" &&
    "document" in value;
}

export type SupabaseSiteContentRepository = Pick<PublicDataRepository, "getSiteContent"> & {
  updateSiteContent(update: Record<string, unknown>): Promise<unknown>;
  getBookingPricing(): Promise<{
    discountRules: Array<{ minDays: number; maxDays: number; percent: number }>;
    extraDriverFee: number;
    childSeatFee: number;
  }>;
};

type SupabaseSiteContentConfig = {
  supabaseUrl?: string;
  serviceRoleKey?: string;
  fetcher?: typeof fetch;
};

function mergeSiteContent(
  current: Record<string, unknown>,
  update: Record<string, unknown>,
): Record<string, unknown> {
  const currentSettings = current.settings;
  const currentLabels = current.labels;
  return {
    ...current,
    ...(isRecord(update.settings) && isRecord(currentSettings)
      ? { settings: { ...currentSettings, ...update.settings } }
      : {}),
    ...(isRecord(update.labels) && isRecord(currentLabels)
      ? { labels: { ...currentLabels, ...update.labels } }
      : {}),
    ...(Array.isArray(update.discountRules) ? { discountRules: update.discountRules } : {}),
    ...(Array.isArray(update.socialLinks) ? { socialLinks: update.socialLinks } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createSupabaseSiteContentRepository(
  config: SupabaseSiteContentConfig,
): SupabaseSiteContentRepository {
  async function request(path: string, init?: RequestInit): Promise<Response> {
    const supabaseUrl = config.supabaseUrl?.trim().replace(/\/+$/, "");
    const serviceRoleKey = config.serviceRoleKey?.trim();
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Supabase site content storage is not configured on the API.");
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
      throw new Error("Supabase site content storage is temporarily unavailable.");
    }
    if (!response.ok) {
      console.error("Supabase site content request failed.", { status: response.status });
      throw new Error("Supabase site content storage could not complete the request.");
    }
    return response;
  }

  async function readRow(): Promise<SiteContentRow | null> {
    const response = await request("site_content_documents?id=eq.public&select=id,document");
    const value: unknown = await response.json();
    if (!Array.isArray(value) || !value.every(isSiteContentRow)) {
      throw new Error("Supabase returned invalid site content data.");
    }
    return value[0] ?? null;
  }

  return {
    async getSiteContent() {
      const row = await readRow();
      return row?.document ?? null;
    },
    async updateSiteContent(update) {
      const current = await readRow();
      if (!current || !isRecord(current.document)) {
        throw new Error("Site content is not initialized.");
      }
      const merged = mergeSiteContent(current.document, update);
      const validated = SiteContentSchema.safeParse(merged);
      if (!validated.success) {
        throw new Error("The updated site content does not match the public content contract.");
      }
      const response = await request("site_content_documents?id=eq.public", {
        method: "PATCH",
        body: JSON.stringify({ document: validated.data }),
      });
      const updated: unknown = await response.json();
      if (!Array.isArray(updated) || !updated[0] || !isSiteContentRow(updated[0])) {
        throw new Error("Site content is not initialized.");
      }
      return updated[0].document;
    },
    async getBookingPricing() {
      const content = await readRow();
      if (!content) throw new Error("Site booking pricing is not initialized.");
      const parsed = SiteContentSchema.safeParse(content.document);
      if (!parsed.success) throw new Error("Site booking pricing is invalid.");
      return {
        discountRules: parsed.data.discountRules,
        extraDriverFee: parsed.data.settings.extraDriverFee,
        childSeatFee: parsed.data.settings.childSeatFee,
      };
    },
  };
}

export function withSupabaseSiteContentForAdmin(
  repository: AdminDataRepository,
  siteContent: SupabaseSiteContentRepository,
): AdminDataRepository {
  return {
    ...repository,
    getSiteContent: siteContent.getSiteContent,
    updateSiteContent: siteContent.updateSiteContent,
  };
}

export function withSupabaseSiteContentForPublic(
  repository: PublicDataRepository,
  siteContent: SupabaseSiteContentRepository,
): PublicDataRepository {
  return {
    ...repository,
    getSiteContent: siteContent.getSiteContent,
  };
}

export function withSupabaseSiteContentForBooking(
  repository: BookingRepository,
  siteContent: SupabaseSiteContentRepository,
): BookingRepository {
  return {
    ...repository,
    getBookingPricing: siteContent.getBookingPricing,
  };
}
