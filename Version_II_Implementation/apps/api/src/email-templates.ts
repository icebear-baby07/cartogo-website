type EmailDetail = {
  label: string;
  value: string;
};

type BrandedEmail = {
  preheader: string;
  eyebrow: string;
  title: string;
  greeting?: string;
  intro: string;
  details?: EmailDetail[];
  highlight?: {
    label: string;
    value: string;
  };
  closing: string;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]!);
}

function renderBrandedEmail(email: BrandedEmail): { html: string; text: string } {
  const detailsText = email.details?.map(({ label, value }) => `${label}: ${value}`) ?? [];
  const detailsHtml = email.details?.length
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:20px 0;background:#f7f5f3;border:1px solid #e6e2de;border-radius:8px">${email.details.map(({ label, value }) => `<tr><td style="padding:10px 14px;border-bottom:1px solid #e6e2de;color:#666;font-size:13px;width:40%">${escapeHtml(label)}</td><td style="padding:10px 14px;border-bottom:1px solid #e6e2de;color:#141414;font-size:14px;font-weight:600">${escapeHtml(value)}</td></tr>`).join("")}</table>`
    : "";
  const highlightHtml = email.highlight
    ? `<div style="margin:22px 0;padding:16px 18px;background:#fff1f0;border-left:4px solid #d62828;border-radius:4px"><div style="color:#666;font-size:12px;text-transform:uppercase;letter-spacing:1px">${escapeHtml(email.highlight.label)}</div><div style="margin-top:6px;color:#141414;font-size:24px;font-weight:700;letter-spacing:2px">${escapeHtml(email.highlight.value)}</div></div>`
    : "";
  const text = [
    "carTOGO.mnl",
    email.eyebrow,
    "",
    email.title,
    "",
    email.greeting,
    email.intro,
    "",
    email.highlight ? `${email.highlight.label}: ${email.highlight.value}` : undefined,
    ...detailsText,
    "",
    email.closing,
    "",
    "carTOGO.mnl",
  ].filter((line): line is string => line !== undefined).join("\n");
  const html = [
    "<!doctype html><html><body style=\"margin:0;padding:0;background:#f3f1ef;font-family:Arial,Helvetica,sans-serif;color:#141414\">",
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(email.preheader)}</div>`,
    "<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background:#f3f1ef;padding:32px 12px\"><tr><td align=\"center\">",
    "<table role=\"presentation\" width=\"600\" cellspacing=\"0\" cellpadding=\"0\" style=\"width:100%;max-width:600px;background:#fff;border:1px solid #e6e2de;border-radius:10px;overflow:hidden\">",
    "<tr><td style=\"height:6px;background:#d62828;font-size:0;line-height:0\">&nbsp;</td></tr>",
    "<tr><td style=\"padding:24px 32px 18px;border-bottom:1px solid #eee\"><div style=\"font-size:22px;font-weight:800;letter-spacing:1px;color:#141414\">carTOGO<span style=\"color:#d62828\">.mnl</span></div></td></tr>",
    "<tr><td style=\"padding:30px 32px 32px\">",
    `<div style="margin-bottom:10px;color:#a81f1f;font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase">${escapeHtml(email.eyebrow)}</div>`,
    `<h1 style="margin:0 0 18px;color:#141414;font-size:26px;line-height:1.25">${escapeHtml(email.title)}</h1>`,
    email.greeting ? `<p style="margin:0 0 12px;color:#242424;font-size:15px;line-height:1.65">${escapeHtml(email.greeting)}</p>` : "",
    `<p style="margin:0;color:#555;font-size:15px;line-height:1.65">${escapeHtml(email.intro)}</p>`,
    highlightHtml,
    detailsHtml,
    `<p style="margin:20px 0 0;color:#555;font-size:14px;line-height:1.65">${escapeHtml(email.closing)}</p>`,
    "</td></tr>",
    "<tr><td style=\"padding:18px 32px;background:#141414;color:#ddd;font-size:12px;line-height:1.6\">Thank you for choosing carTOGO.mnl.<br><span style=\"color:#aaa\">We’re here to help with your rental plans.</span></td></tr>",
    "</table></td></tr></table></body></html>",
  ].join("");
  return { html, text };
}

export function inquiryConfirmationEmail(inquiry: Record<string, unknown>): { html: string; text: string } {
  const name = typeof inquiry.name === "string" && inquiry.name.trim() ? inquiry.name.trim() : "there";
  const details: EmailDetail[] = [
    ["Vehicle", "car_name"],
    ["Pickup", "pickup_date"],
    ["Pickup time", "pickup_time"],
    ["Return", "return_date"],
    ["Rental subtotal", "rental_subtotal"],
    ["Estimated total", "quoted_rate"],
  ].flatMap(([label, key]) => {
    const value = inquiry[key];
    if (value === undefined || value === null || value === "") return [];
    return [{ label, value: key === "quoted_rate"
      ? `₱${Number(value).toLocaleString("en-PH")}`
      : key === "rental_subtotal"
        ? `₱${Number(value).toLocaleString("en-PH")}`
      : String(value) }];
  });
  if (inquiry.extra_driver === true) {
    details.splice(-1, 0, {
      label: "Extra Driver",
      value: `Selected · ₱${Number(inquiry.extra_driver_fee ?? 0).toLocaleString("en-PH")}`,
    });
  }
  if (inquiry.child_seat === true) {
    details.splice(-1, 0, {
      label: "Child seat",
      value: `Selected · ₱${Number(inquiry.child_seat_fee ?? 0).toLocaleString("en-PH")}`,
    });
  }
  return renderBrandedEmail({
    preheader: "We received your car rental inquiry.",
    eyebrow: "Inquiry received",
    title: "Thank you for reaching out",
    greeting: `Hi ${name},`,
    intro: "We’ve received your car rental inquiry. Our team will review the details and follow up with you by email to confirm availability and next steps.",
    details,
    closing: "This is a request only; your rental is not confirmed and no payment has been taken. If you have questions, reply to this email and our team will be happy to help.",
  });
}

export function emailVerificationEmail(code: string): { html: string; text: string } {
  return renderBrandedEmail({
    preheader: "Your email verification code is ready.",
    eyebrow: "Email verification",
    title: "Verify your email address",
    intro: "Enter this code on the booking page to verify your email address and continue with your inquiry.",
    highlight: { label: "Your verification code", value: code },
    closing: "This code is valid for 10 minutes. If you didn’t request it, you can ignore this email.",
  });
}

export function inquiryRejectionEmail(name: string, reason: string): { html: string; text: string } {
  return renderBrandedEmail({
    preheader: "There’s an update about your car rental inquiry.",
    eyebrow: "Inquiry update",
    title: "We’re unable to proceed with your inquiry",
    greeting: `Hello ${name || "there"},`,
    intro: "Thank you for considering carTOGO.mnl. Unfortunately, we’re unable to proceed with this request.",
    details: [{ label: "Reason", value: reason }],
    closing: "If you have questions or would like help with another date or vehicle, reply to this email and our team will assist you.",
  });
}

function readableLabel(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function approvalDetails(value: unknown, prefix = ""): EmailDetail[] {
  if (Array.isArray(value)) {
    if (value.length === 0) return prefix ? [{ label: readableLabel(prefix), value: "None" }] : [];
    return value.flatMap((item, index) => approvalDetails(item, `${prefix} ${index + 1}`.trim()));
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, child]) =>
      approvalDetails(child, prefix ? `${prefix} · ${readableLabel(key)}` : readableLabel(key)),
    );
  }
  if (!prefix) return [];
  return [{
    label: prefix,
    value: typeof value === "string" ? value : String(value),
  }];
}

export function ownerApprovalEmail(input: {
  operation: string;
  resource: string;
  requester: string;
  data: Record<string, unknown>;
  code: string;
}): { html: string; text: string } {
  const details = approvalDetails(input.data).slice(0, 30);
  return renderBrandedEmail({
    preheader: "An administrator is requesting your approval.",
    eyebrow: "Administrator approval",
    title: `${input.operation} ${readableLabel(input.resource)}`,
    intro: `${input.requester} has requested this change. Review the request and enter the approval code in the administrator page only if you recognize it.`,
    details,
    highlight: { label: "Approval code · expires in 5 minutes", value: input.code },
    closing: "This code approves only the request described above. If you didn’t expect this request, do not enter the code.",
  });
}
