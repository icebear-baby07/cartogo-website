import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import test from "node:test";
import { createPublicDataRouter, type PublicDataRepository } from "./public-data.js";

const unit = {
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
};

const location = {
  id: 1,
  asset_type: "location",
  loc_name: "Pickup point A",
  coordinates: { lat: 14.72, lng: 120.93 },
  display_name: "Quezon City",
  description: "Pickup location",
  status: "open",
};

const siteContent = {
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
    termsAndConditions: "Renters are responsible for returning the vehicle on time.",
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
};

async function request(
  repository: PublicDataRepository,
  path: string,
): Promise<Response> {
  const app = express();
  app.use("/api", createPublicDataRouter(async () => repository));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    return await fetch(`http://127.0.0.1:${address.port}${path}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test("serves validated public fleet data", async () => {
  const response = await request(
    {
      async listPublicUnits() {
        return [unit];
      },
      async listSiteAssets() {
        return [];
      },
      async getSiteContent() {
        return siteContent;
      },
    },
    "/api/public/units",
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [unit]);
});

test("serves validated site assets and public site content", async () => {
  const repository = {
    async listPublicUnits() {
      return [];
    },
    async listSiteAssets() {
      return [location];
    },
    async getSiteContent() {
      return siteContent;
    },
  };

  const assetsResponse = await request(repository, "/api/site-assets");
  assert.equal(assetsResponse.status, 200);
  assert.deepEqual(await assetsResponse.json(), [location]);

  const contentResponse = await request(repository, "/api/site-content");
  assert.equal(contentResponse.status, 200);
  assert.deepEqual(await contentResponse.json(), siteContent);
});

test("returns service unavailable for invalid MongoDB records", async () => {
  const response = await request(
    {
      async listPublicUnits() {
        return [{ ...unit, capacity: 0 }];
      },
      async listSiteAssets() {
        return [];
      },
      async getSiteContent() {
        return siteContent;
      },
    },
    "/api/public/units",
  );

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "Public fleet data is unavailable.",
  });
});

test("reports uninitialized public site content explicitly", async () => {
  const response = await request(
    {
      async listPublicUnits() {
        return [];
      },
      async listSiteAssets() {
        return [];
      },
      async getSiteContent() {
        return null;
      },
    },
    "/api/site-content",
  );

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "Site content is not initialized.",
  });
});

test("maps repository failures to a non-sensitive unavailable response", async () => {
  const response = await request(
    {
      async listPublicUnits() {
        throw new Error("private MongoDB connection detail");
      },
      async listSiteAssets() {
        return [];
      },
      async getSiteContent() {
        return siteContent;
      },
    },
    "/api/public/units",
  );

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "Public fleet data is unavailable.",
  });
});
