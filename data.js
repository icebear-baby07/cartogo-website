/* ==========================================================================
   carTOGO.mnl — DATA LAYER (js/data.js)
   --------------------------------------------------------------------------
   Every read/write to stored data goes through the `DB` object below.
   main.js (public site) and admin.js (admin panel) never touch localStorage
   directly — they only call DB.get___() / DB.save___() / DB.addInquiry().

   WHY THIS MATTERS FOR YOU:
   Right now DB is implemented with the browser's localStorage, which is
   great for building/testing but is PER BROWSER — inquiries submitted by a
   real visitor land in *their* browser, not yours. See README.md, section
   "Connecting real data storage", for four ways to upgrade this file to a
   real shared backend. Because every other file calls DB instead of
   localStorage directly, upgrading storage means editing ONLY this file.
   ========================================================================== */

const STORAGE_KEY = "carTOGOmnl.v1";
const SUPABASE_URL = "https://mtuvqchmbueudbrumppd.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10dXZxY2htYnVldWRicnVtcHBkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcxODI3NDQsImV4cCI6MjEwMjc1ODc0NH0.6dIB912NK9DWLXPBnsnCC3am_e323q0WT5hvKFERne8";
const supa = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
/* ---------- Seed content (used the very first time the site loads) ---------- */
const SEED_DATA = {
  settings: {
    companyName: "carTOGO.mnl",
    tagline: "Rent. Drive. Go.",
    currency: "₱",
    depositPercent: 20,
    extraDriverFee: 300,
    childSeatFee: 150,
    lateFeePerHour: 250,
    adminPassword: "carTOGO2026"
  },

  labels: {
    hero: {
      title: "Your trip starts with <em>carTOGO.mnl</em>.",
      subtitle: "Clean, well-maintained cars, clear daily rates, and easy reservations. Get on the road with carTOGO.mnl."
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
      { icon: "card", title: "Clear pricing", description: "Daily rates and deposit estimates are shown before you inquire." },
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
    { id: "c1", name: "Honda City — Ignited Red Metallic", category: "Sedan", seats: 5, transmission: "Automatic", fuel: "Gasoline", rate: 2200, image: "images/honda-city-red.jpg", blurb: "A stylish and comfortable sedan for city driving, business trips, and weekend getaways.", available: true },
    { id: "c2", name: "Mitsubishi Mirage G4 — Red", category: "Sedan", seats: 5, transmission: "Automatic", fuel: "Gasoline", rate: 1900, image: "images/mirage-g4-red.jpg", blurb: "Fuel-efficient, easy to drive, and practical for everyday travel around Metro Manila.", available: true },
    { id: "c3", name: "Mitsubishi Mirage G4 — Silver", category: "Sedan", seats: 5, transmission: "Automatic", fuel: "Gasoline", rate: 1900, image: "images/mirage-g4-silver.jpg", blurb: "A practical and economical choice for errands, work trips, and city adventures.", available: true },
    { id: "c4", name: "Toyota Fortuner", category: "SUV", seats: 7, transmission: "Automatic", fuel: "Diesel", rate: 4500, image: "images/toyota-fortuner.jpg", blurb: "A spacious seven-seater SUV made for family trips, long drives, and out-of-town adventures.", available: true }
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

/* ---------- Public DB API ----------
   All methods are written as async functions even though localStorage is
   synchronous. Do this on purpose: it means every caller already uses
   `await DB.something()`, so swapping the body of these methods for a
   `fetch()` call to a real backend later requires NO changes anywhere else.
------------------------------------------------------------------------- */
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
    return SEED_DATA.labels;
  },
  async saveLabels(labels) {
    const data = _readAll();
    data.labels = { ...data.labels, ...labels };
    _writeAll(data);
    return data.labels;
  },

  // --- Cars / fleet + rates ---
  async getCars() {
    return SEED_DATA.cars;
  },
  async saveCar(car) {
    const data = _readAll();
    if (car.id) {
      const idx = data.cars.findIndex(c => c.id === car.id);
      if (idx > -1) { data.cars[idx] = { ...data.cars[idx], ...car }; }
      else { data.cars.push(car); }
    } else {
      car.id = _uid("c");
      data.cars.push(car);
    }
    _writeAll(data);
    return car;
  },
  async deleteCar(carId) {
    const data = _readAll();
    data.cars = data.cars.filter(c => c.id !== carId);
    _writeAll(data);
    return true;
  },

  // --- Inquiries (this is the "client information" store) ---
 async getInquiries() {
    // Pull everything from your online database table
    const { data, error } = await supa
        .from('inquiries')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error("Failed to fetch inquiries:", message);
        return [];
    }
    return data || [];
},
async addInquiry(inquiry) {
    // Save customer message straight to Supabase online
   const payload = { 
      name: inquiry.name, 
      email: inquiry.email,
      phone: inquiry.phone,
      secondary_phone: inquiry.secondaryPhone || null,
      car_id: inquiry.carId,
      car_name: inquiry.carName,
      pickup_date: inquiry.pickupDate,
      return_date: inquiry.returnDate,
      location: inquiry.location,
      notes: inquiry.notes
    };

    const { data, error } = await supa
      .from('inquiries')
      .insert([payload]);

    if (error) {
      console.error("Database Save Error Details:", error);
      throw error;
    }
    return data;
  },


  async updateInquiry(id, patch) {
    const data = _readAll();
    const idx = data.inquiries.findIndex(i => i.id === id);
    if (idx === -1) return null;
    data.inquiries[idx] = { ...data.inquiries[idx], ...patch };
    _writeAll(data);
    return data.inquiries[idx];
  },
  async deleteInquiry(id) {
    const data = _readAll();
    data.inquiries = data.inquiries.filter(i => i.id !== id);
    _writeAll(data);
    return true;
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
