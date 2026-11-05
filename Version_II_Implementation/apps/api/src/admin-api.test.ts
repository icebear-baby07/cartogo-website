import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createAdminRouter, type AdminDataRepository } from "./admin-api.js";

function createRepository(): AdminDataRepository {
  return {
    async listUnits() { return [{ id: 1, display_name: "Honda City" }]; },
    async listSiteAssets() { return []; },
    async getSiteContent() { return null; },
    async listInquiries() { return []; },
    async listChatSessions() { return []; },
    async getAdminRole(email) { return { email, titles: ["Moderator"] }; },
    async listAdminRoles(emails) { return emails.map((email) => ({ email, titles: ["Moderator"] })); },
    async hasPermission(_email, permission) { return ["fleet", "inquiries"].includes(permission); },
    async listOwnerEmails() { return ["owner@example.com"]; },
    async setAdminTitles() { return null; },
    async saveApproval() {},
    async getApproval() { return null; },
    async incrementApprovalAttempts() { return 1; },
    async consumeApproval() { return true; },
    async applyUnitChange() { return null; },
    async applySiteAssetChange() { return null; },
    async updateSiteContent() { return null; },
    async updateInquiryStatus(id, status) { return { id, status }; },
    async restoreInquiry() { return null; },
    async rejectInquiry() { return {}; },
    async getInquiry() { return null; },
    async markInquiryRejectionEmailSent() { return null; },
    async deleteInquiry(id) { return { id }; },
    async removeAdminRole() {},
    async deleteChatSession(id) { return { id }; },
  };
}

async function createServer(repository: AdminDataRepository) {
  const app = express();
  app.use(express.json());
  app.use("/api/admin", (request, _response, next) => {
    request.authenticatedAdmin = { id: "admin-1", email: "moderator@example.com" };
    next();
  });
  app.use("/api/admin", createAdminRouter(async () => repository, {}));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}/api/admin`,
    async close() {
      server.close();
      await once(server, "close");
    },
  };
}

test("serves protected admin identity and fleet data", async () => {
  const server = await createServer(createRepository());
  try {
    const identity = await fetch(`${server.baseUrl}/me`);
    assert.equal(identity.status, 200);
    assert.deepEqual(await identity.json(), {
      email: "moderator@example.com",
      titles: ["Moderator"],
    });

    const fleet = await fetch(`${server.baseUrl}/units`);
    assert.equal(fleet.status, 200);
    assert.deepEqual(await fleet.json(), [{ id: 1, display_name: "Honda City" }]);
  } finally {
    await server.close();
  }
});

test("enforces role permissions for admin endpoints", async () => {
  const server = await createServer(createRepository());
  try {
    const response = await fetch(`${server.baseUrl}/site-assets`);
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: "Your administrator title does not allow this action.",
    });
  } finally {
    await server.close();
  }
});

test("validates inquiry actions before changing records", async () => {
  const server = await createServer(createRepository());
  try {
    const response = await fetch(`${server.baseUrl}/inquiries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update", id: 1, status: "pending_review" }),
    });

    test("accepts new fleet units without client-generated IDs", async () => {
      const server = await createServer(createRepository());
      try {
        const response = await fetch(`${server.baseUrl}/owner-change/request`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            resource: "unit",
            action: "add",
            data: {
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
            },
          }),
        });
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), {
          error: "Configure SMTP credentials in apps/api/.env before requesting owner approval.",
        });
      } finally {
        await server.close();
      }
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "Choose a valid inquiry status." });
  } finally {
    await server.close();
  }
});
