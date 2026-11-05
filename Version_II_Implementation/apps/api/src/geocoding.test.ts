import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import test from "node:test";
import {
  createGeocodingRouter,
  createNominatimGeocoder,
  type GeocodedLocation,
} from "./geocoding.js";

async function request(
  searchLocations: (query: string) => Promise<GeocodedLocation[]>,
  url: string,
): Promise<Response> {
  const app = express();
  app.use("/api", createGeocodingRouter(searchLocations));
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
