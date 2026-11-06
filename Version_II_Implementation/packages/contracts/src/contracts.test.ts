import assert from "node:assert/strict";
import test from "node:test";
import {
  ApiErrorSchema,
  ApiHealthSchema,
  ApiReadinessSchema,
  PublicUnitSchema,
  SiteAssetSchema,
  SiteContentSchema,
} from "./index.js";

test("validates the API health response and rejects unexpected service identities", () => {
  assert.equal(
    ApiHealthSchema.parse({
      status: "ok",
      service: "cartogo-version-ii-api",
    }).status,
    "ok",
  );
  assert.equal(
    ApiHealthSchema.safeParse({
      status: "ok",
      service: "unexpected-service",
    }).success,
    false,
  );
});

test("validates both readiness states without conflating liveness and readiness", () => {
  assert.equal(
    ApiReadinessSchema.parse({
      status: "ready",
      dependencies: { mongodb: "ok" },
    }).status,
    "ready",
  );
  assert.equal(
    ApiReadinessSchema.parse({
      status: "not_ready",
      dependencies: { mongodb: "unavailable" },
    }).status,
    "not_ready",
  );
  assert.equal(
    ApiReadinessSchema.safeParse({
      status: "ready",
      dependencies: { mongodb: "unavailable" },
    }).success,
    false,
  );
});

test("validates vehicle data while preserving additional database fields", () => {
  const parsed = PublicUnitSchema.parse({
    id: 1,
    display_name: "Honda City",
    brand: "Honda",
    model: "City",
    capacity: 5,
    in12_rate: 2000,
    in24_rate: 3500,
    out12_rate: 2500,
    out24_rate: 4000,
    luzon_rate: 5000,
    status: "Available",
    features: ["Automatic"],
    legacy_field: "preserved",
  });
  assert.equal(parsed.legacy_field, "preserved");
  assert.equal(
    PublicUnitSchema.safeParse({ ...parsed, capacity: 0 }).success,
    false,
  );
});

test("validates location and contact assets using the existing Mongo document shape", () => {
  assert.equal(
    SiteAssetSchema.parse({
      id: 1,
      asset_type: "location",
      loc_name: "Pickup point A",
      coordinates: { lat: 14.72, lng: 120.93 },
      display_name: "Quezon City",
      description: "Pickup location",
      status: "open",
    }).asset_type,
    "location",
  );
  assert.equal(
    SiteAssetSchema.parse({
      id: 4,
      asset_type: "contact",
      display_name: "Live agent",
      description: "",
      phone: "+63 2 8555 0142",
      email: "hello@cartogo.mnl",
      operational_hours: "Daily",
      status: "open",
    }).asset_type,
    "contact",
  );
  assert.equal(
    SiteAssetSchema.safeParse({
      id: 1,
      asset_type: "location",
      display_name: "Invalid coordinates",
      description: "",
      coordinates: { lat: 95, lng: 120 },
      status: "open",
    }).success,
    false,
  );
});

test("validates the public site-content seed structure and API error shape", () => {
  const termsAndConditions = "Renters are responsible for returning the vehicle on time.";
  assert.equal(
    SiteContentSchema.safeParse({
      settings: {
        companyName: "carTOGO.mnl",
        tagline: "Rent. Drive. Go.",
        currency: "₱",
        depositPercent: 20,
        extraDriverFee: 300,
        childSeatFee: 150,
        lateFeePerHour: 250,
      },
      labels: {
        termsAndConditions,
        hero: { title: "Welcome", subtitle: "Reliable rentals." },
        trustStrip: [],
        howItWorks: [],
        whyChooseUs: [],
        about: { title: "About", body: "About carTOGO." },
        faq: [],
        testimonials: [],
      },
      discountRules: [{ minDays: 4, maxDays: 7, percent: 5 }],
      socialLinks: [{ platform: "facebook", label: "Facebook", url: "" }],
    }).success,
    true,
  );
  assert.equal(
    SiteContentSchema.safeParse({
      settings: {
        companyName: "carTOGO.mnl",
        tagline: "Rent. Drive. Go.",
        currency: "₱",
        depositPercent: 20,
        extraDriverFee: 300,
        childSeatFee: 150,
        lateFeePerHour: 250,
      },
      labels: {
        termsAndConditions: { text: "Not a string" },
        hero: { title: "Welcome", subtitle: "Reliable rentals." },
        trustStrip: [],
        howItWorks: [],
        whyChooseUs: [],
        about: { title: "About", body: "About carTOGO." },
        faq: [],
        testimonials: [],
      },
      discountRules: [{ minDays: 4, maxDays: 7, percent: 5 }],
      socialLinks: [{ platform: "facebook", label: "Facebook", url: "" }],
    }).success,
    false,
  );
  assert.deepEqual(ApiErrorSchema.parse({ error: "Not found." }), {
    error: "Not found.",
  });
  assert.equal(ApiErrorSchema.safeParse({ error: "" }).success, false);
});
