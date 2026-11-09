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
    async hasPermission(_email, permission) { return ["fleet", "inquiries"].includes(permission); },
    async listOwnerEmails() { return ["owner@example.com"]; },
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
    async deleteChatSession(id) { return { id }; },
  };
}

function createInquiryRepository(deleteFailsOnce = false) {
  const repository = createRepository();
  const events: string[] = [];
  let inquiry: Record<string, unknown> | null = {
    id: 1,
    email: "customer@example.com",
    firstName: "Customer",
    status: "pending_review",
  };
  let failedDelete = false;
  repository.getInquiry = async () => inquiry;
  repository.rejectInquiry = async (_id, reason) => {
    if (!inquiry) throw new Error("That inquiry no longer exists.");
    inquiry = { ...inquiry, status: "rejected", rejection_reason: reason, rejection_email_sent: false };
    events.push("rejected");
    return inquiry;
  };
  repository.markInquiryRejectionEmailSent = async () => {
    if (inquiry) inquiry = { ...inquiry, rejection_email_sent: true };
    events.push("email-marked");
    return inquiry;
  };
  repository.deleteInquiry = async (id) => {
    events.push("delete");
    if (deleteFailsOnce && !failedDelete) {
      failedDelete = true;
      throw new Error("MongoDB unavailable.");
    }
    inquiry = null;
    return { id };
  };
  return { repository, events, get inquiry() { return inquiry; } };
}

async function createServer(
  repository: AdminDataRepository,
  config: Parameters<typeof createAdminRouter>[1] = {},
) {
  const app = express();
  app.use(express.json());
  app.use("/api/admin", (request, _response, next) => {
    request.authenticatedAdmin = { id: "admin-1", email: "moderator@example.com" };
    next();
  });
  app.use("/api/admin", createAdminRouter(async () => repository, config));
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

test("does not expose the retired administrator-accounts panel endpoint", async () => {
  const server = await createServer(createRepository());
  try {
    const response = await fetch(`${server.baseUrl}/roles`);
    assert.equal(response.status, 404);
  } finally {
    await server.close();
  }
});

test("rejects owner changes for retired administrator-account resources", async () => {
  const server = await createServer(createRepository());
  try {
    const response = await fetch(`${server.baseUrl}/owner-change/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resource: "admin_accounts",
        action: "add",
        data: { email: "new-admin@example.com" },
      }),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "Choose a supported owner-approved change.",
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
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "Choose a valid inquiry status." });
  } finally {
    await server.close();
  }
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

test("accepts Terms and Conditions in owner-approved site content", async () => {
  const repository = createRepository();
  repository.hasPermission = async (_email, permission) => permission === "site_content";
  repository.getSiteContent = async () => ({
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
      hero: { title: "Welcome", subtitle: "Reliable rentals." },
      trustStrip: [],
      howItWorks: [],
      whyChooseUs: [],
      about: { title: "About", body: "About carTOGO." },
      faq: [],
      testimonials: [],
    },
    discountRules: [],
    socialLinks: [],
  });
  const server = await createServer(repository);
  try {
    const response = await fetch(`${server.baseUrl}/owner-change/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resource: "site_content",
        action: "update",
        data: { labels: { termsAndConditions: "Updated rental terms." } },
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

test("confirms an inquiry when the admin sends the confirmed status", async () => {
  const server = await createServer(createRepository());
  try {
    const response = await fetch(`${server.baseUrl}/inquiries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update", id: 1, status: "confirmed" }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { data: { id: 1, status: "confirmed" } });
  } finally {
    await server.close();
  }
});

test("emails the customer before deleting a rejected inquiry", async () => {
  const state = createInquiryRepository();
  const server = await createServer(state.repository, {
    sendEmail: async (to, subject, text, html) => {
      assert.equal(to, "customer@example.com");
      assert.match(subject, /update about your carTOGO.mnl inquiry/i);
      assert.match(text, /unable to proceed/i);
      assert.match(String(html), /carTOGO<span/);
      state.events.push("email-accepted");
    },
  });
  try {
    const response = await fetch(`${server.baseUrl}/inquiries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reject", id: 1, reason: "The vehicle is unavailable." }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      data: { id: 1 },
      emailSent: true,
      deleted: true,
    });
    assert.deepEqual(state.events, ["rejected", "email-accepted", "email-marked", "delete"]);
    assert.equal(state.inquiry, null);
  } finally {
    await server.close();
  }
});

test("keeps a rejected inquiry when the email fails and allows retry", async () => {
  const state = createInquiryRepository();
  let shouldFail = true;
  const server = await createServer(state.repository, {
    sendEmail: async () => {
      if (shouldFail) throw new Error("SMTP unavailable.");
      state.events.push("email-accepted");
    },
  });
  try {
    const firstResponse = await fetch(`${server.baseUrl}/inquiries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reject", id: 1, reason: "The vehicle is unavailable." }),
    });
    assert.equal(firstResponse.status, 503);
    assert.equal((await firstResponse.json() as { error: string }).error.includes("inquiry was kept"), true);
    assert.deepEqual(state.events, ["rejected"]);
    assert.equal(state.inquiry?.status, "rejected");
    assert.equal(state.inquiry?.rejection_email_sent, false);

    shouldFail = false;
    const retryResponse = await fetch(`${server.baseUrl}/inquiries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reject", id: 1 }),
    });
    assert.equal(retryResponse.status, 200);
    assert.equal(state.events.at(-1), "delete");
    assert.equal(state.inquiry, null);
  } finally {
    await server.close();
  }
});

test("does not resend rejection email when deletion needs a retry", async () => {
  const state = createInquiryRepository(true);
  let emailCount = 0;
  const server = await createServer(state.repository, {
    sendEmail: async () => {
      emailCount += 1;
    },
  });
  try {
    const request = () => fetch(`${server.baseUrl}/inquiries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reject", id: 1, reason: "The vehicle is unavailable." }),
    });
    const firstResponse = await request();
    assert.equal(firstResponse.status, 503);
    assert.equal(state.inquiry?.rejection_email_sent, true);

    const retryResponse = await fetch(`${server.baseUrl}/inquiries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reject", id: 1 }),
    });
    assert.equal(retryResponse.status, 200);
    assert.equal(emailCount, 1);
    assert.equal(state.inquiry, null);
  } finally {
    await server.close();
  }
});
