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

export type TargetLocationValidation = {
  valid: boolean;
  label: string;
  reason?: string;
  address?: Record<string, unknown>;
  rateRegion?: "in" | "out" | "luzon" | "out_of_bounds" | null;
  category?: string;
  type?: string;
  snapped?: boolean;
  latitude?: number;
  longitude?: number;
  snapDistanceMeters?: number;
};

export type GeocodingServices = {
  searchLocations: (query: string) => Promise<GeocodedLocation[]>;
  validateTargetLocation: (
    latitude: number,
    longitude: number,
    snapInvalid?: boolean,
  ) => Promise<TargetLocationValidation>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const cacheDurationMs = 10 * 60_000;
const minimumRequestIntervalMs = 1_100;
const maximumCacheEntries = 200;

function normalizeText(value: unknown): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function classifyTargetRegion(address: Record<string, unknown>): TargetLocationValidation["rateRegion"] {
  const parts = Object.values(address)
    .filter((value): value is string => typeof value === "string")
    .map(normalizeText);
  const matches = (candidates: string[]) =>
    parts.some((part) => candidates.some((candidate) => part === candidate || part.includes(candidate)));
  const island = normalizeText(address.island);
  if (island && island !== "luzon" && island !== "luzon island") return "out_of_bounds";
  if (matches([
    "visayas", "western visayas", "central visayas", "eastern visayas", "negros island region",
    "mindanao", "northern mindanao", "davao region", "soccsksargen", "zamboanga peninsula",
    "caraga", "bangsamoro", "barmm", "mimaropa", "palawan", "batanes", "marinduque",
    "occidental mindoro", "oriental mindoro", "mindoro", "romblon", "catanduanes", "masbate",
    "aklan", "antique", "bacolod", "basilan", "biliran", "bohol", "bukidnon", "cagayan de oro",
    "camiguin", "capiz", "cebu", "davao de oro", "compostela valley", "davao del norte",
    "davao del sur", "davao occidental", "davao oriental", "dinagat islands", "eastern samar",
    "guimaras", "iloilo", "lanao del norte", "lanao del sur", "leyte", "maguindanao",
    "misamis occidental", "misamis oriental", "negros occidental", "negros oriental",
    "northern samar", "samar", "siquijor", "south cotabato", "southern leyte", "sulu",
    "surigao del norte", "surigao del sur", "tawi tawi", "zamboanga del norte",
    "zamboanga del sur", "zamboanga sibugay",
  ])) return "out_of_bounds";
  if (matches([
    "national capital region", "metro manila", "ncr", "caloocan", "las pinas", "makati", "malabon",
    "mandaluyong", "manila", "marikina", "muntinlupa", "navotas", "paranaque", "pasay", "pasig",
    "quezon city", "san juan", "taguig", "valenzuela", "pateros",
  ])) return "in";
  if (matches(["bulacan", "rizal", "cavite", "laguna"])) return "out";
  if (matches([
    "ilocos region", "cagayan valley", "central luzon", "calabarzon", "bicol region",
    "cordillera administrative region", "luzon", "abra", "albay", "apayao", "aurora", "bataan",
    "batangas", "benguet", "cagayan", "camarines norte", "camarines sur", "ifugao",
    "ilocos norte", "ilocos sur", "isabela", "kalinga", "la union", "mountain province", "nueva ecija",
    "nueva vizcaya", "pampanga", "pangasinan", "quezon", "quirino", "sorsogon", "tarlac", "zambales",
  ])) return "luzon";
  return null;
}

function assessTargetLocation(result: unknown): TargetLocationValidation {
  const label = isRecord(result) && typeof result.display_name === "string" ? result.display_name : "";
  if (!isRecord(result) || !isRecord(result.address)) {
    return {
      valid: false,
      label,
      reason: "We couldn't verify this location. Choose a mapped residential area near a road.",
    };
  }
  const address = result.address;
  const category = String(result.category || result.class || "").toLowerCase();
  const type = String(result.type || "").toLowerCase();
  const blockedCategories = new Set([
    "natural", "waterway", "railway", "aeroway", "military",
    "amenity", "shop", "office", "tourism", "leisure", "craft",
  ]);
  const blockedTypes = new Set([
    "bay", "beach", "cliff", "coastline", "forest", "glacier", "lake", "marsh",
    "mountain", "ocean", "peak", "reservoir", "river", "sea", "wetland", "wood",
    "airport", "commercial", "industrial", "retail", "warehouse", "island", "islet",
  ]);
  const hasRoad = ["road", "pedestrian", "living_street"].some((key) => address[key]);
  const hasSettlement = [
    "neighbourhood", "suburb", "city_district", "city", "town", "village", "hamlet",
  ].some((key) => address[key]);
  const accessibleRoad = category === "highway" && new Set([
    "living_street", "motorway", "motorway_link", "primary", "primary_link", "residential",
    "road", "secondary", "secondary_link", "service", "tertiary", "tertiary_link",
    "trunk", "trunk_link", "unclassified",
  ]).has(type);
  const residentialContext =
    (category === "building" && new Set([
      "apartments", "bungalow", "detached", "house", "residential", "semidetached_house", "terrace",
    ]).has(type))
    || (category === "landuse" && type === "residential")
    || (category === "place" && new Set(["neighbourhood", "suburb", "village", "hamlet"]).has(type))
    || (category === "highway" && new Set([
      "living_street", "residential", "road", "service", "tertiary", "tertiary_link", "unclassified",
    ]).has(type));
  if (blockedCategories.has(category) || blockedTypes.has(type)) {
    return {
      valid: false,
      label,
      reason: "Choose a road-connected residential location, not water, natural terrain, or a non-residential site.",
    };
  }
  if (!hasRoad || !(accessibleRoad || (hasSettlement && residentialContext))) {
    return {
      valid: false,
      label,
      reason: "We couldn't verify an accessible mapped road or residential location. Choose another point near a road.",
    };
  }
  return {
    valid: true,
    label,
    address,
    category,
    type,
    rateRegion: classifyTargetRegion(address),
  };
}

export function createNominatimLocationServices(options: GeocoderOptions = {}): GeocodingServices {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const searchCache = new Map<string, { expiresAt: number; results: GeocodedLocation[] }>();
  const validationCache = new Map<string, { expiresAt: number; result: TargetLocationValidation }>();
  let nextRequestAt = 0;
  let requestQueue = Promise.resolve();

  async function fetchRateLimited(
    url: string,
    rateLimited = true,
    userAgentLabel = "website location search",
  ): Promise<globalThis.Response> {
    if (!rateLimited) {
      return fetcher(url, {
        headers: { Accept: "application/json", "User-Agent": "carTOGO.mnl website location validation" },
        signal: AbortSignal.timeout(8_000),
      });
    }
    const request = requestQueue.then(async () => {
      const waitMs = Math.max(0, nextRequestAt - now());
      if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
      nextRequestAt = now() + minimumRequestIntervalMs;
      return fetcher(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": `carTOGO.mnl ${userAgentLabel}${options.contactEmail?.trim() ? ` (${options.contactEmail.trim()})` : ""}`,
        },
        signal: AbortSignal.timeout(8_000),
      });
    });
    requestQueue = request.then(() => undefined, () => undefined);
    return request;
  }

  const searchLocations = async (query: string): Promise<GeocodedLocation[]> => {
    const normalizedQuery = query.trim().replace(/\s+/g, " ").toLocaleLowerCase();
    const cached = searchCache.get(normalizedQuery);
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
    if (searchCache.size >= maximumCacheEntries) {
      const oldest = searchCache.keys().next().value;
      if (oldest !== undefined) searchCache.delete(oldest);
    }
    searchCache.set(normalizedQuery, { expiresAt: now() + cacheDurationMs, results });
    return results;
  };

  const validateTargetLocation = async (
    latitude: number,
    longitude: number,
    snapInvalid = false,
  ): Promise<TargetLocationValidation> => {
    const cacheKey = `${latitude.toFixed(6)},${longitude.toFixed(6)}`;
    const cached = validationCache.get(cacheKey);
    if (cached && cached.expiresAt > now()) {
      if (cached.result.valid || !snapInvalid) return cached.result;
      return snapTarget(latitude, longitude, cached.result);
    }

    const params = new URLSearchParams({
      format: "jsonv2",
      lat: latitude.toFixed(6),
      lon: longitude.toFixed(6),
      zoom: "18",
      addressdetails: "1",
    });
    let response: globalThis.Response;
    try {
      response = await fetchRateLimited(
        `https://nominatim.openstreetmap.org/reverse?${params}`,
        true,
        "website location validation",
      );
    } catch (error) {
      throw new Error("Location verification is temporarily unavailable. Please try again.", { cause: error });
    }
    if (!response.ok) throw new Error("Location verification is temporarily unavailable. Please try again.");
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new Error("Location verification returned an invalid response.", { cause: error });
    }
    const assessment = assessTargetLocation(payload);
    if (assessment.valid) {
      assessment.latitude = latitude;
      assessment.longitude = longitude;
    }
    if (validationCache.size >= maximumCacheEntries) {
      const oldest = validationCache.keys().next().value;
      if (oldest !== undefined) validationCache.delete(oldest);
    }
    validationCache.set(cacheKey, { expiresAt: now() + cacheDurationMs, result: assessment });
    return snapInvalid && !assessment.valid
      ? snapTarget(latitude, longitude, assessment)
      : assessment;
  };

  async function snapTarget(
    latitude: number,
    longitude: number,
    original: TargetLocationValidation,
  ): Promise<TargetLocationValidation> {
    let response: globalThis.Response;
    try {
      response = await fetchRateLimited(
        `https://router.project-osrm.org/nearest/v1/driving/${longitude.toFixed(6)},${latitude.toFixed(6)}?number=1&radiuses=unlimited`,
        false,
      );
    } catch (error) {
      throw new Error("Nearby roads could not be checked. Please try again.", { cause: error });
    }
    if (!response.ok) throw new Error("Nearby roads could not be checked. Please try again.");
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new Error("Nearby road lookup returned an invalid response.", { cause: error });
    }
    const waypoint = isRecord(payload) && payload.code === "Ok" && Array.isArray(payload.waypoints)
      ? payload.waypoints[0]
      : null;
    const location = isRecord(waypoint) ? waypoint.location : null;
    const distance = isRecord(waypoint) ? waypoint.distance : null;
    if (
      !Array.isArray(location) || location.length !== 2 ||
      typeof location[0] !== "number" || typeof location[1] !== "number" ||
      !Number.isFinite(location[0]) || !Number.isFinite(location[1]) ||
      location[0] < -180 || location[0] > 180 || location[1] < -90 || location[1] > 90 ||
      typeof distance !== "number" || !Number.isFinite(distance) || distance < 0
    ) {
      return {
        ...original,
        reason: "I couldn't find a suitable mapped road for this location. Please choose another point.",
      };
    }
    const snapped = await validateTargetLocation(location[1], location[0]);
    if (!snapped.valid) {
      return {
        ...snapped,
        reason: "I couldn't confirm this location. Please choose another place.",
      };
    }
    return {
      ...snapped,
      snapped: true,
      latitude: location[1],
      longitude: location[0],
      snapDistanceMeters: Math.round(distance * 10) / 10,
    };
  }

  return { searchLocations, validateTargetLocation };
}

export function createNominatimGeocoder(options: GeocoderOptions = {}) {
  return createNominatimLocationServices(options).searchLocations;
}

export function createGeocodingRouter(
  searchLocations: (query: string) => Promise<GeocodedLocation[]>,
  validateTargetLocation?: GeocodingServices["validateTargetLocation"],
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

  router.post("/target-location/validate", async (request, response: ExpressResponse) => {
    const { latitude, longitude, snapInvalid = false } = request.body ?? {};
    if (
      typeof latitude !== "number" || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      typeof longitude !== "number" || !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
      typeof snapInvalid !== "boolean"
    ) {
      response.status(400).json({ error: "Provide valid latitude and longitude coordinates." });
      return;
    }
    if (!validateTargetLocation) {
      response.status(503).json({ error: "Location verification is not configured." });
      return;
    }
    try {
      response.json(await validateTargetLocation(latitude, longitude, snapInvalid));
    } catch (error) {
      console.error(
        "Location verification failed.",
        error instanceof Error ? error.name : "UnknownError",
      );
      response.status(503).json({
        error: error instanceof Error ? error.message : "Location verification is temporarily unavailable.",
      });
    }
  });

  return router;
}
