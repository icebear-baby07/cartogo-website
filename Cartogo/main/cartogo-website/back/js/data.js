/* Public site data and inquiries are served from MongoDB; authentication remains in Supabase. */
const SUPABASE_URL = window.CARTOGO_CONFIG?.supabaseUrl;
const SUPABASE_KEY = window.CARTOGO_CONFIG?.supabaseAnonKey;
if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("Supabase configuration is missing. Check main/cartogo-website/.env and restart the website server.");
const supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    autoRefreshToken: true,
    detectSessionInUrl: true,
    persistSession: true,
    flowType: "pkce"
  }
});
let SITE_CONTENT_CACHE = null;

async function siteDataRequest(path, options = {}) {
  const response = await fetch(path, {
    cache: "no-store",
    ...options
  });
  const responseText = await response.text();
  let result;
  try {
    result = responseText ? JSON.parse(responseText) : {};
  } catch {
    const error = new Error(response.status === 404
      ? `Requested endpoint not found (404): ${path}`
      : "The server returned an invalid response.");
    error.status = response.status;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(result.error || "Could not load site data.");
    error.status = response.status;
    throw error;
  }
  return result;
}

async function adminRequest(path, payload) {
  const { data, error } = await supa.auth.getSession();
  if (error) throw error;
  const accessToken = data.session?.access_token;
  if (!accessToken) throw new Error("Sign in again to manage site data.");
  return siteDataRequest(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify(payload)
  });
}

/* ---------- Public DB API ---------- */
const DB = {
  async getSiteContent() {
    if (SITE_CONTENT_CACHE) return SITE_CONTENT_CACHE;
    SITE_CONTENT_CACHE = await siteDataRequest("/api/site-content");
    return SITE_CONTENT_CACHE;
  },
  async getSiteContentDefaults() {
    return siteDataRequest("/api/site-content/defaults");
  },
  // --- Public settings and page copy ---
  async getSettings() {
    const content = SITE_CONTENT_CACHE || await this.getSiteContent();
    return content.settings;
  },
  async getLabels() {
    const content = SITE_CONTENT_CACHE || await this.getSiteContent();
    return content.labels;
  },

  // --- Units / public fleet + rates ---
  async getUnits({ admin = false } = {}) {
    if (!admin) return siteDataRequest("/api/public/units");
    const { data, error } = await supa.auth.getSession();
    if (error) throw error;
    const accessToken = data.session?.access_token;
    if (!accessToken) throw new Error("Sign in again to view all units.");
    return siteDataRequest("/api/admin/units", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
  },
  async getCars() {
    const units = await this.getUnits();
    return units.map(unit => {
      const features = Array.isArray(unit.features) ? unit.features : [];
      return {
        id: String(unit.id),
        name: unit.display_name,
        category: unit.brand,
        model: unit.model,
        seats: unit.capacity,
        in12_rate: Number(unit.in12_rate),
        in24_rate: Number(unit.in24_rate),
        out12_rate: Number(unit.out12_rate),
        out24_rate: Number(unit.out24_rate),
        luzon_rate: Number(unit.luzon_rate),
        status: unit.status,
        available: unit.status === "Available",
        features,
        image: "",
        blurb: features.join(" · ") || `${unit.brand} ${unit.model}`
      };
    });
  },
  async requestUnitChange(action, unit) {
    return adminRequest("/api/admin/owner-change/request", { resource: "unit", action, data: unit });
  },
  async approveUnitChange(challengeId, code) {
    return adminRequest("/api/admin/owner-change/approve", { challengeId, code });
  },

  async getSiteAssets({ admin = false } = {}) {
    if (!admin) return siteDataRequest("/api/site-assets");
    const { data, error } = await supa.auth.getSession();
    if (error) throw error;
    const accessToken = data.session?.access_token;
    if (!accessToken) throw new Error("Sign in again to view site assets.");
    return siteDataRequest("/api/admin/site-assets", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
  },
  async requestSiteAssetChange(action, asset) {
    return adminRequest("/api/admin/owner-change/request", { resource: "site_assets", action, data: asset });
  },
  async approveSiteAssetChange(challengeId, code) {
    return adminRequest("/api/admin/owner-change/approve", { challengeId, code });
  },
  async requestOwnerChange(resource, action, data) {
    return adminRequest("/api/admin/owner-change/request", { resource, action, data });
  },
  async approveOwnerChange(challengeId, code) {
    const result = await adminRequest("/api/admin/owner-change/approve", { challengeId, code });
    if (result.resource === "site_content") SITE_CONTENT_CACHE = result.data;
    return result;
  },

  // --- Inquiries (this is the "client information" store) ---
  async getInquiries() {
    const { data, error } = await supa.auth.getSession();
    if (error) throw error;
    const accessToken = data.session?.access_token;
    if (!accessToken) throw new Error("Sign in again to view inquiries.");
    return siteDataRequest("/api/admin/inquiries", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
  },
  async addInquiry(inquiry) {
    let accessToken = null;
    if (inquiry.googleAuthenticated) {
      const { data, error } = await supa.auth.getSession();
      if (error) throw error;
      accessToken = data.session?.access_token;
      if (!accessToken) throw new Error("Your Google sign-in expired. Sign in again or submit as a guest.");
    }
    const payload = {
      name: inquiry.name,
      firstName: inquiry.firstName,
      lastName: inquiry.lastName,
      middleName: inquiry.middleName,
      suffix: inquiry.suffix,
      email: inquiry.email,
      emailVerificationToken: inquiry.emailVerificationToken || null,
      carId: inquiry.carId,
      carName: inquiry.carName,
      phone: inquiry.phone,
      rentalMode: inquiry.rentalMode,
      capacity: inquiry.capacity,
      pickupDate: inquiry.pickupDate,
      pickupTime: inquiry.pickupTime,
      returnDate: inquiry.returnDate,
      location: inquiry.location,
      targetLatitude: inquiry.targetLatitude,
      targetLongitude: inquiry.targetLongitude,
      nearestPickupName: inquiry.nearestPickupName,
      nearestPickupDistanceKm: inquiry.nearestPickupDistanceKm,
      rateRegion: inquiry.rateRegion,
      rentalPeriodHours: inquiry.rentalPeriodHours,
      estimatedRentalHours: inquiry.estimatedRentalHours,
      ratePerPeriod: inquiry.ratePerPeriod,
      rentalDays: inquiry.rentalDays,
      discountPercent: inquiry.discountPercent,
      discountAmount: inquiry.discountAmount,
      quotedRate: inquiry.quotedRate,
      notes: inquiry.notes,
      secondaryPhone: inquiry.secondaryPhone || null
    };
    const requestHeaders = { "Content-Type": "application/json" };
    if (accessToken) requestHeaders.Authorization = `Bearer ${accessToken}`;
    const result = await siteDataRequest("/api/inquiries", {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(payload)
    });
    return {
      data: result.data,
      emailNotificationSent: result.emailNotificationSent === true
    };
  },
  async requestGuestEmailCode(email) {
    try {
      return await siteDataRequest("/api/email-verification/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });
    } catch (error) {
      if (error.status === 404) {
        throw new Error("Email verification service not found (404). Restart or update the website server, then refresh the page.");
      }
      throw error;
    }
  },
  async verifyGuestEmailCode(challengeId, code) {
    return siteDataRequest("/api/email-verification/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challengeId, code })
    });
  },


  async updateInquiry(id, patch) {
    const result = await adminRequest("/api/admin/inquiries", {
      action: "update",
      id,
      status: patch.status
    });
    return result.data;
  },
  async rejectInquiry(id, reason) {
    return adminRequest("/api/admin/inquiries", {
      action: "reject",
      id,
      reason
    });
  },
  async resendInquiryRejection(id) {
    return adminRequest("/api/admin/inquiries", {
      action: "resend_rejection",
      id
    });
  },
  async deleteInquiry(id) {
    await adminRequest("/api/admin/inquiries", { action: "delete", id });
    return true;
  },

  async getAdminEmails() {
    const { data, error } = await supa.rpc("get_cartogo_admin_emails");
    if (error) throw error;
    return data;
  },
  async isAdmin() {
    const { data, error } = await supa.rpc("is_cartogo_admin");
    if (error) throw error;
    return data === true;
  },

  // --- Chat sessions (Supabase only) ---
  async getChatSessions() {
    const remote = await supa
      .from("chat_sessions")
      .select()
      .order("last_message_at", { ascending: false });
    if (remote.error) throw remote.error;
    return (remote.data || []).map(session => ({
      id: session.id,
      username: session.username || "Guest",
      startedAt: session.started_at,
      lastMessageAt: session.last_message_at,
      messages: session.messages || []
    }));
  },
  async saveChatSession(session) {
    const remote = await supa.from("chat_sessions").upsert([{
      id: session.id,
      username: session.username || "Guest",
      started_at: session.startedAt,
      last_message_at: session.lastMessageAt,
      messages: session.messages
    }]);
    if (remote.error) throw remote.error;
    return session;
  },
};

/* ---------- Small shared helpers used by both main.js and admin.js ---------- */
function formatCurrency(amount, currencySymbol) {
  const num = Number(amount) || 0;
  return currencySymbol + num.toLocaleString("en-PH", { maximumFractionDigits: 0 });
}

function formatDate(isoString) {
  const d = new Date(isoString);
  return d.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" }) +
    " " + d.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" });
}
