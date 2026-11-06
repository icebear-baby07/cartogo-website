import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import test from "node:test";
import {
  createNominatimLocationServices,
  createGeocodingRouter,
  createNominatimGeocoder,
  type GeocodedLocation,
  type TargetLocationValidation,
} from "./geocoding.js";

async function request(
  searchLocations: (query: string) => Promise<GeocodedLocation[]>,
  url: string,
  validateTargetLocation?: (
    latitude: number,
    longitude: number,
    snapInvalid?: boolean,
  ) => Promise<TargetLocationValidation>,
): Promise<Response> {
  const app = express();
  app.use(express.json());
  app.use("/api", createGeocodingRouter(searchLocations, validateTargetLocation));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    return await fetch(`http://127.0.0.1:${address.port}${url}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function postJson(
  path: string,
  body: unknown,
  validateTargetLocation: (
    latitude: number,
    longitude: number,
    snapInvalid?: boolean,
  ) => Promise<TargetLocationValidation>,
): Promise<Response> {
  const app = express();
  app.use(express.json());
  app.use("/api", createGeocodingRouter(async () => [], validateTargetLocation));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    return await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test("validates location search query lengths", async () => {
  const response = await request(async () => [], "/api/target-location/search?q=ab");
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Enter a location search between 3 and 200 characters.",
  });
});

test("returns normalized Philippine search results", async () => {
  let requestedUrl = "";
  let userAgent = "";
  const geocode = createNominatimGeocoder({
    now: () => 1_000,
    fetcher: async (input, init) => {
      requestedUrl = String(input);
      userAgent = new Headers(init?.headers).get("User-Agent") ?? "";
      return new Response(JSON.stringify([
        { display_name: "Quezon City, Metro Manila, Philippines", lat: "14.676", lon: "121.043" },
        { display_name: "Invalid point", lat: "91", lon: "181" },
        { display_name: 100, lat: "14", lon: "121" },
      ]), { status: 200 });
    },
  });
  const result = await geocode("Quezon City");
  assert.deepEqual(result, [{
    label: "Quezon City, Metro Manila, Philippines",
    latitude: 14.676,
    longitude: 121.043,
  }]);
  assert.match(requestedUrl, /^https:\/\/nominatim\.openstreetmap\.org\/search\?/);
  assert.match(requestedUrl, /countrycodes=ph/);
  assert.equal(userAgent, "carTOGO.mnl website location search");
});

test("caches normalized location queries", async () => {
  let calls = 0;
  const geocode = createNominatimGeocoder({
    now: () => 1_000,
    fetcher: async () => {
      calls += 1;
      return new Response(JSON.stringify([]), { status: 200 });
    },
  });
  await geocode("Makati City");
  await geocode("  Makati   City ");
  assert.equal(calls, 1);
});

test("maps geocoder failures to a non-sensitive service response", async () => {
  const response = await request(
    async () => {
      throw new Error("Location search is temporarily unavailable.");
    },
    "/api/target-location/search?q=Makati",
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "Location search is temporarily unavailable.",
  });
});

test("validates coordinate bounds and forwards valid destination checks", async () => {
  let received: [number, number, boolean] | undefined;
  const validate = async (
    latitude: number,
    longitude: number,
    snapInvalid = false,
  ): Promise<TargetLocationValidation> => {
    received = [latitude, longitude, snapInvalid];
    return { valid: true, label: "Makati City", rateRegion: "in" };
  };
  const invalid = await postJson("/api/target-location/validate", {
    latitude: 91,
    longitude: 121,
    snapInvalid: true,
  }, validate);
  assert.equal(invalid.status, 400);
  assert.equal(received, undefined);

  const valid = await postJson("/api/target-location/validate", {
    latitude: 14.55,
    longitude: 121.02,
    snapInvalid: true,
  }, validate);
  assert.equal(valid.status, 200);
  assert.deepEqual(received, [14.55, 121.02, true]);
  assert.deepEqual(await valid.json(), { valid: true, label: "Makati City", rateRegion: "in" });
});

test("reverse-geocodes verified road-connected destinations and classifies their rate area", async () => {
  let calls = 0;
  const services = createNominatimLocationServices({
    now: () => 10_000,
    fetcher: async (input) => {
      calls += 1;
      assert.match(String(input), /^https:\/\/nominatim\.openstreetmap\.org\/reverse\?/);
      return Response.json({
        display_name: "Makati City, Metro Manila, Philippines",
        class: "highway",
        type: "residential",
        address: {
          road: "Ayala Avenue",
          suburb: "Bel-Air",
          city: "Makati",
          state: "Metro Manila",
          island: "Luzon",
        },
      });
    },
  });
  const first = await services.validateTargetLocation(14.5547, 121.0244);
  const second = await services.validateTargetLocation(14.5547, 121.0244);
  assert.equal(first.valid, true);
  assert.equal(first.rateRegion, "in");
  assert.equal(first.label, "Makati City, Metro Manila, Philippines");
  assert.equal(first.latitude, 14.5547);
  assert.equal(first.longitude, 121.0244);
  assert.equal(second.rateRegion, "in");
  assert.equal(calls, 1);
});

test("rejects non-residential locations and snaps to a verified nearby road", async () => {
  const requestedUrls: string[] = [];
  const services = createNominatimLocationServices({
    now: () => 10_000,
    fetcher: async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.startsWith("https://router.project-osrm.org/")) {
        return Response.json({
          code: "Ok",
          waypoints: [{ location: [121.0245, 14.5548], distance: 18.6 }],
        });
      }
      const snappedReverse = url.includes("lat=14.554800");
      return Response.json(snappedReverse
        ? {
          display_name: "Makati City, Metro Manila, Philippines",
          class: "highway",
          type: "residential",
          address: { road: "Ayala Avenue", suburb: "Bel-Air", city: "Makati", state: "Metro Manila", island: "Luzon" },
        }
        : {
          display_name: "Makati Bay",
          class: "natural",
          type: "water",
          address: { water: "Makati Bay", city: "Makati", state: "Metro Manila", island: "Luzon" },
        });
    },
  });
  const result = await services.validateTargetLocation(14.5547, 121.0244, true);
  assert.equal(result.valid, true);
  assert.equal(result.snapped, true);
  assert.equal(result.latitude, 14.5548);
  assert.equal(result.longitude, 121.0245);
  assert.equal(result.snapDistanceMeters, 18.6);
  assert.equal(result.rateRegion, "in");
  assert.equal(requestedUrls.length, 3);
});
