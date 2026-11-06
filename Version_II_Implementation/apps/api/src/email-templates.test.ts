import assert from "node:assert/strict";
import test from "node:test";
import {
  emailVerificationEmail,
  inquiryConfirmationEmail,
  inquiryRejectionEmail,
  ownerApprovalEmail,
} from "./email-templates.js";

test("formats a clear branded inquiry confirmation with the rental summary", () => {
  const message = inquiryConfirmationEmail({
    name: "Alex Renter",
    car_name: "Honda City",
    pickup_date: "2026-11-10",
    pickup_time: "09:00",
    return_date: "2026-11-11",
    quoted_rate: 3500,
  });

  assert.match(message.text, /Thank you for reaching out/);
  assert.match(message.text, /Honda City/);
  assert.match(message.text, /Estimated total: ₱3,500/);
  assert.match(message.text, /no payment has been taken/i);
  assert.match(message.html, /carTOGO<span/);
});

test("formats a readable verification email and highlights the code", () => {
  const message = emailVerificationEmail("123456");
  assert.match(message.text, /123456/);
  assert.match(message.text, /10 minutes/i);
  assert.match(message.html, /Your verification code/);
  assert.match(message.html, /123456/);
});

test("formats an inquiry update and safely escapes customer-provided content", () => {
  const message = inquiryRejectionEmail("<Customer>", "<Unavailable> & dates");
  assert.match(message.text, /<Customer>/);
  assert.match(message.html, /&lt;Customer&gt;/);
  assert.match(message.html, /&lt;Unavailable&gt; &amp; dates/);
});

test("formats administrator approval details as readable labels", () => {
  const message = ownerApprovalEmail({
    operation: "Update",
    resource: "site content",
    requester: "admin@example.com",
    data: { settings: { companyName: "carTOGO.mnl" } },
    code: "654321",
  });
  assert.match(message.text, /Company Name: carTOGO\.mnl/);
  assert.match(message.text, /654321/);
  assert.doesNotMatch(message.text, /"settings"|Requested values/);
});
