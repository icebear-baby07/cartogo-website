import { Router, type Response as ExpressResponse } from "express";

export type GeocodedLocation = {
  label: string;
  latitude: number;
  longitude: number;
};

type NominatimResult = {
  display_name?: unknown;
  lat?: unknown;
  lon?: unknown;
};

type GeocoderOptions = {
  contactEmail?: string;
  fetcher?: typeof fetch;
  now?: () => number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const cacheDurationMs = 10 * 60_000;
const minimumRequestIntervalMs = 1_100;
const maximumCacheEntries = 200;

export function createNominatimGeocoder(options: GeocoderOptions = {}) {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { expiresAt: number; results: GeocodedLocation[] }>();
  let nextRequestAt = 0;
  let requestQueue = Promise.resolve();

  async function fetchRateLimited(url: string): Promise<globalThis.Response> {
    const request = requestQueue.then(async () => {
      const waitMs = Math.max(0, nextRequestAt - now());
      if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
      nextRequestAt = now() + minimumRequestIntervalMs;
      return fetcher(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": `carTOGO.mnl website location search${options.contactEmail?.trim() ? ` (${options.contactEmail.trim()})` : ""}`,
        },
        signal: AbortSignal.timeout(8_000),
      });
    });
    requestQueue = request.then(() => undefined, () => undefined);
    return request;
  }

  return async function searchLocations(query: string): Promise<GeocodedLocation[]> {
    const normalizedQuery = query.trim().replace(/\s+/g, " ").toLocaleLowerCase();
    const cached = cache.get(normalizedQuery);
    if (cached && cached.expiresAt > now()) return cached.results;

    const params = new URLSearchParams({
      format: "jsonv2",
      q: query.trim().replace(/\s+/g, " "),
      countrycodes: "ph",
      limit: "5",
      addressdetails: "1",
    });
    let response: globalThis.Response;
    try {
      response = await fetchRateLimited(`https://nominatim.openstreetmap.org/search?${params}`);
    } catch (error) {
      throw new Error("Location search is temporarily unavailable.", { cause: error });
    }
    if (!response.ok) throw new Error("Location search is temporarily unavailable.");

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new Error("Location search returned an invalid response.", { cause: error });
    }
    if (!Array.isArray(payload)) throw new Error("Location search returned an invalid response.");

    const results: GeocodedLocation[] = [];
    for (const value of payload) {
      if (!isRecord(value)) continue;
      const item = value as NominatimResult;
      if (typeof item.display_name !== "string") continue;
      if (
        (typeof item.lat !== "string" && typeof item.lat !== "number") ||
        (typeof item.lon !== "string" && typeof item.lon !== "number") ||
        (typeof item.lat === "string" && !item.lat.trim()) ||
        (typeof item.lon === "string" && !item.lon.trim())
      ) {
        continue;
      }
      const latitude = Number(item.lat);
      const longitude = Number(item.lon);
      if (
        !Number.isFinite(latitude) ||
        latitude < -90 ||
        latitude > 90 ||
        !Number.isFinite(longitude) ||
        longitude < -180 ||
        longitude > 180
      ) {
        continue;
      }
      results.push({ label: item.display_name, latitude, longitude });
    }
    if (cache.size >= maximumCacheEntries) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(normalizedQuery, { expiresAt: now() + cacheDurationMs, results });
    return results;
  };
}

export function createGeocodingRouter(
  searchLocations: (query: string) => Promise<GeocodedLocation[]>,
): Router {
  const router = Router();

  router.get("/target-location/search", async (request, response: ExpressResponse) => {
    const query = typeof request.query.q === "string" ? request.query.q.trim() : "";
    if (query.length < 3 || query.length > 200) {
      response.status(400).json({ error: "Enter a location search between 3 and 200 characters." });
      return;
    }
    try {
      response.json(await searchLocations(query));
    } catch (error) {
      console.error(
        "Location search failed.",
        error instanceof Error ? error.name : "UnknownError",
      );
      response.status(503).json({
        error: error instanceof Error ? error.message : "Location search is temporarily unavailable.",
      });
    }
  });

  return router;
}
