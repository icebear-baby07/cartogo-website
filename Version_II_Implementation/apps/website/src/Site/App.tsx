import { useCallback, useEffect, useState } from "react";
import type {
  ApiReadiness,
  PublicUnit,
  SiteAsset,
  SiteContent,
} from "@cartogo/contracts";
import PublicSite from "./PublicSite";

type PublicPageData = {
  units: PublicUnit[];
  assets: SiteAsset[];
  content: SiteContent;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPublicUnit(value: unknown): value is PublicUnit {
  return (
    isRecord(value) &&
    Number.isInteger(value.id) &&
    typeof value.display_name === "string" &&
    typeof value.brand === "string" &&
    typeof value.model === "string" &&
    Number.isInteger(value.capacity) &&
    ["in12_rate", "in24_rate", "out12_rate", "out24_rate", "luzon_rate"].every(
      (field) => isFiniteNumber(value[field]) && value[field] >= 0,
    ) &&
    ["Available", "Rented", "Maintenance", "Inactive"].includes(
      String(value.status),
    ) &&
    Array.isArray(value.features) &&
    value.features.every((feature) => typeof feature === "string")
  );
}

function isSiteAsset(value: unknown): value is SiteAsset {
  if (
    !isRecord(value) ||
    !Number.isInteger(value.id) ||
    typeof value.display_name !== "string" ||
    typeof value.description !== "string" ||
    (value.status !== "open" && value.status !== "closed")
  ) {
    return false;
  }
  if (value.asset_type === "location") {
    return (
      isRecord(value.coordinates) &&
      isFiniteNumber(value.coordinates.lat) &&
      value.coordinates.lat >= -90 &&
      value.coordinates.lat <= 90 &&
      isFiniteNumber(value.coordinates.lng) &&
      value.coordinates.lng >= -180 &&
      value.coordinates.lng <= 180
    );
  }
  return value.asset_type === "contact";
}

function hasStrings(value: unknown, fields: string[]): boolean {
  return isRecord(value) && fields.every((field) => typeof value[field] === "string");
}

function isSiteContent(value: unknown): value is SiteContent {
  if (!isRecord(value) || !isRecord(value.settings) || !isRecord(value.labels)) {
    return false;
  }

  const { settings, labels } = value;
  const settingsValid =
    hasStrings(settings, ["companyName", "tagline", "currency"]) &&
    ["depositPercent", "extraDriverFee", "childSeatFee", "lateFeePerHour"].every(
      (field) => isFiniteNumber(settings[field]) && settings[field] >= 0,
    );
  const labelsValid =
    hasStrings(labels.hero, ["title", "subtitle"]) &&
    Array.isArray(labels.trustStrip) &&
    labels.trustStrip.every((item) => hasStrings(item, ["value", "label"])) &&
    Array.isArray(labels.howItWorks) &&
    labels.howItWorks.every((item) => hasStrings(item, ["title", "description"])) &&
    Array.isArray(labels.whyChooseUs) &&
    labels.whyChooseUs.every((item) =>
      hasStrings(item, ["icon", "title", "description"]),
    ) &&
    hasStrings(labels.about, ["title", "body"]) &&
    Array.isArray(labels.faq) &&
    labels.faq.every((item) => hasStrings(item, ["q", "a"])) &&
    Array.isArray(labels.testimonials) &&
    labels.testimonials.every((item) =>
      hasStrings(item, ["quote", "name", "detail"]),
    );
  const pricingValid =
    Array.isArray(value.discountRules) &&
    value.discountRules.every(
      (rule) =>
        isRecord(rule) &&
        Number.isInteger(rule.minDays) &&
        Number.isInteger(rule.maxDays) &&
        isFiniteNumber(rule.percent),
    ) &&
    Array.isArray(value.socialLinks) &&
    value.socialLinks.every((link) =>
      hasStrings(link, ["platform", "label", "url"]),
    );

  return settingsValid && labelsValid && pricingValid;
}

async function fetchResource<T>(
  path: string,
  validate: (value: unknown) => value is T,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, { cache: "no-store", signal });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      isRecord(body) && typeof body.error === "string"
        ? body.error
        : `Request failed (${response.status}).`;
    throw new Error(message);
  }
  if (!validate(body)) {
    throw new Error(`The server returned invalid public data for ${path}.`);
  }
  return body;
}

function isUnits(value: unknown): value is PublicUnit[] {
  return Array.isArray(value) && value.every(isPublicUnit);
}

function isAssets(value: unknown): value is SiteAsset[] {
  return Array.isArray(value) && value.every(isSiteAsset);
}

function isApiReadiness(value: unknown): value is ApiReadiness {
  if (!isRecord(value) || !isRecord(value.dependencies)) return false;
  return (
    (value.status === "ready" && value.dependencies.mongodb === "ok") ||
    (value.status === "not_ready" &&
      value.dependencies.mongodb === "unavailable")
  );
}

export default function App() {
  const [data, setData] = useState<PublicPageData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const loadPublicPage = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const readinessResponse = await fetch("/api/health/ready", {
        cache: "no-store",
        signal,
      });
      const readiness: unknown = await readinessResponse.json().catch(() => null);
      if (!isApiReadiness(readiness)) {
        throw new Error("The API returned an invalid readiness response.");
      }
      if (readiness.status !== "ready") {
        throw new Error(
          "The API is running, but MongoDB is not ready. Configure MONGODB_URI in apps/api/.env, then restart the dev server.",
        );
      }

      const [units, assets, content] = await Promise.all([
        fetchResource("/api/public/units", isUnits, signal),
        fetchResource("/api/site-assets", isAssets, signal),
        fetchResource("/api/site-content", isSiteContent, signal),
      ]);
      if (!signal?.aborted) setData({ units, assets, content });
    } catch (loadError) {
      if (!signal?.aborted) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Public site data is temporarily unavailable.",
        );
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadPublicPage(controller.signal);
    return () => controller.abort();
  }, [loadPublicPage]);

  if (loading) {
    return (
      <main className="system-state" aria-live="polite">
        <p className="eyebrow">carTOGO.mnl</p>
        <h1>Loading the road ahead</h1>
        <p>Getting the latest fleet, rates, and pickup details.</p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="system-state" role="alert">
        <p className="eyebrow">Temporary service issue</p>
        <h1>We could not load the site</h1>
        <p>{error}</p>
        <button className="button button-primary" onClick={() => void loadPublicPage()}>
          Try again
        </button>
      </main>
    );
  }

  return <PublicSite {...data} />;
}
