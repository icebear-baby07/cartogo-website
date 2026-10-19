/* Site seed data, browser-local settings, Supabase inquiries, and chat sessions. */

const STORAGE_KEY = "carTOGOmnl.v1";
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
/* ---------- Seed content (used the very first time the site loads) ---------- */
const SEED_DATA = {
  settings: {
    companyName: "carTOGO.mnl",
    tagline: "Rent. Drive. Go.",
    currency: "₱",
    depositPercent: 20,
    extraDriverFee: 300,
    childSeatFee: 150,
    lateFeePerHour: 250
  },

  labels: {
    hero: {
      title: "Your trip starts with <em>carTOGO.mnl</em>.",
      subtitle: "Clean, well-maintained cars, clear rental rates, and easy reservations. Get on the road with carTOGO.mnl."
    },
    trustStrip: [
      { value: "4", label: "Cars in our fleet" },
      { value: "4", label: "Vehicle options" },
      { value: "Metro Manila", label: "Pickup area" },
      { value: "Easy", label: "Online inquiry" }
    ],
    howItWorks: [
      { title: "Choose your ride", description: "Filter the fleet by category and pick the car that fits your trip." },
      { title: "Pick your dates", description: "Set pickup and return dates — we hold your quoted rate for 24 hours." },
      { title: "Confirm the details", description: "Submit your info below; our team confirms availability within 2 hours." },
      { title: "Pick up & go", description: "Bring your license and ID to your chosen pickup point and hit the road." }
    ],
    whyChooseUs: [
      { icon: "car", title: "Choice of vehicles", description: "Pick from compact sedans or a spacious SUV based on your trip." },
      { icon: "clipboard", title: "Simple inquiry", description: "Send your preferred dates and vehicle through the online form." },
      { icon: "card", title: "Clear pricing", description: "Rental rates and deposit estimates are shown before you inquire." },
      { icon: "location", title: "Metro Manila pickup", description: "Choose a pickup area that works for your schedule." },
      { icon: "phone", title: "Direct assistance", description: "Our contact details are available for questions and booking confirmation." },
      { icon: "key", title: "Ready to drive", description: "Once your reservation is confirmed, complete the required pickup documents and go." }
    ],
    about: {
      title: "Built for simple, reliable car rentals",
      body: "cartogo.mnl focuses on simple, reliable car rentals in Metro Manila, with clear rates, clean vehicles, straightforward booking, and a team ready to help."
    },
    faq: [
      { q: "What do I need to rent a car?", a: "A valid driver's license held for at least one year, one government-issued ID, and a credit or debit card for the security deposit." },
      { q: "Is insurance included in the rate?", a: "Yes. Comprehensive insurance with a standard deductible is included in every quoted rate — no add-on required." },
      { q: "What's your fuel policy?", a: "Every car leaves full and should come back full. Cars returned with less fuel are charged at pump price plus a small refueling fee." },
      { q: "Can I change or cancel my booking?", a: "Yes, free of charge up to 24 hours before your pickup time. Changes inside 24 hours may be subject to availability." },
      { q: "Do you deliver to the airport?", a: "Yes — our airport-area pickup can be arranged with the team when you submit your inquiry." }
    ],
    contact: {
      phone: "+63 2 8555 0142",
      email: "hello@cartogo.mnl",
      hours: "Mon – Sun, 6:00 AM – 10:00 PM",
      locations: [
        "Quezon City — Fairview",
        "Airport Area — Pasay",
        "Quezon City — Commonwealth Ave"
      ]
    },
    testimonials: [
      { quote: "Choose a compact sedan for everyday city trips.", name: "Honda City", detail: "Ignited Red Metallic" },
      { quote: "A practical and economical option for Metro Manila travel.", name: "Mirage G4", detail: "Red or Silver" },
      { quote: "Bring the family and extra luggage with a seven-seat SUV.", name: "Toyota Fortuner", detail: "SUV · 7 seats" }
    ]
  },

  cars: [
    { id: "c1", name: "Honda City — Ignited Red Metallic", category: "Sedan", seats: 5, transmission: "Automatic", fuel: "Gasoline", rate: 2200, image: "../assets/photos/honda-city-red.jpg", blurb: "A stylish and comfortable sedan for city driving, business trips, and weekend getaways.", available: true },
    { id: "c2", name: "Mitsubishi Mirage G4 — Red", category: "Sedan", seats: 5, transmission: "Automatic", fuel: "Gasoline", rate: 1900, image: "../assets/photos/mirage-g4-red.jpg", blurb: "Fuel-efficient, easy to drive, and practical for everyday travel around Metro Manila.", available: true },
    { id: "c3", name: "Mitsubishi Mirage G4 — Silver", category: "Sedan", seats: 5, transmission: "Automatic", fuel: "Gasoline", rate: 1900, image: "../assets/photos/mirage-g4-silver.jpg", blurb: "A practical and economical choice for errands, work trips, and city adventures.", available: true },
    { id: "c4", name: "Toyota Fortuner", category: "SUV", seats: 7, transmission: "Automatic", fuel: "Diesel", rate: 4500, image: "../assets/photos/toyota-fortuner.jpg", blurb: "A spacious seven-seater SUV made for family trips, long drives, and out-of-town adventures.", available: true }
  ],

  /* Real visitor submissions land here. Empty on first load, on purpose. */
  inquiries: []
};

/* ---------- Internal read/write helpers ---------- */
function _readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(SEED_DATA));
      return JSON.parse(JSON.stringify(SEED_DATA));
    }
    return JSON.parse(raw);
  } catch (err) {
    console.error("carTOGO.mnl DB: failed to read storage, falling back to seed data.", err);
    return JSON.parse(JSON.stringify(SEED_DATA));
  }
}

function _writeAll(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (err) {
    console.error("carTOGO.mnl DB: failed to write storage.", err);
    return false;
  }
}

function _uid(prefix) {
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

async function unitApprovalRequest(path, payload) {
  const { data, error } = await supa.auth.getSession();
  if (error) throw error;
  const accessToken = data.session?.access_token;
  if (!accessToken) throw new Error("Sign in again to manage unit inventory.");
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify(payload)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The unit change could not be approved.");
  return result;
}

/* ---------- Public DB API ---------- */
const DB = {
  // --- Settings (company name, currency, fees) ---
  async getSettings() {
    return _readAll().settings;
  },
  async saveSettings(settings) {
    const data = _readAll();
    data.settings = { ...data.settings, ...settings };
    _writeAll(data);
    return data.settings;
  },

  // --- Labels (all editable site copy) ---
  async getLabels() {
    const labels = _readAll().labels;
    return labels || JSON.parse(JSON.stringify(SEED_DATA.labels));
  },
  async saveLabels(labels) {
    const data = _readAll();
    data.labels = { ...data.labels, ...labels };
    _writeAll(data);
    return data.labels;
  },

  // --- Units / public fleet + rates ---
  async getUnits() {
    const { data, error } = await supa
      .from("unit_data")
      .select("*")
      .order("id", { ascending: true });
    if (error) throw error;
    return data || [];
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
    return unitApprovalRequest("/api/unit-data/request", { action, unit });
  },
  async approveUnitChange(challengeId, code) {
    return unitApprovalRequest("/api/unit-data/approve", { challengeId, code });
  },

  // --- Inquiries (this is the "client information" store) ---
  async getInquiries() {
    const { data, error } = await supa
      .from("inquiries")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  },
  async addInquiry(inquiry) {
    const payload = {
      name: inquiry.name,
      email: inquiry.email || null,
      phone: inquiry.phone,
      secondary_phone: inquiry.secondaryPhone || null,
      car_id: inquiry.carId,
      car_name: inquiry.carName,
      capacity: inquiry.capacity,
      pickup_date: inquiry.pickupDate,
      return_date: inquiry.returnDate,
      location: inquiry.location,
      target_latitude: inquiry.targetLatitude,
      target_longitude: inquiry.targetLongitude,
      nearest_pickup_name: inquiry.nearestPickupName,
      nearest_pickup_distance_km: inquiry.nearestPickupDistanceKm,
      rate_region: inquiry.rateRegion,
      rental_period_hours: inquiry.rentalPeriodHours,
      estimated_rental_hours: inquiry.estimatedRentalHours,
      rate_per_period: inquiry.ratePerPeriod,
      quoted_rate: inquiry.quotedRate,
      notes: inquiry.notes,
      status: inquiry.status,
      user_id: inquiry.userId || null,
      verification_method: inquiry.verificationMethod
    };
    const { data, error } = await supa
      .from("inquiries")
      .insert(payload);
    if (error) throw error;
    return data;
  },


  async updateInquiry(id, patch) {
    const { data, error } = await supa
      .from("inquiries")
      .update({ status: patch.status })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
  async deleteInquiry(id) {
    const { error } = await supa.from("inquiries").delete().eq("id", id);
    if (error) throw error;
    return true;
  },

  async getAdminEmails() {
    const { data, error } = await supa.rpc("get_cartogo_admin_emails");
    if (error) throw error;
    return data;
  },
  async addAdminEmail(email) {
    const { data, error } = await supa.rpc("add_cartogo_admin_email", { p_email: email });
    if (error) throw error;
    return data;
  },
  async removeAdminEmail(email) {
    const { data, error } = await supa.rpc("remove_cartogo_admin_email", { p_email: email });
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
  async deleteChatSession(id) {
    const remote = await supa.from("chat_sessions").delete().eq("id", id);
    if (remote.error) throw remote.error;
    return true;
  },

  // --- Danger zone: reset everything back to the seed content ---
  async resetAll() {
    _writeAll(JSON.parse(JSON.stringify(SEED_DATA)));
    return true;
  }
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
