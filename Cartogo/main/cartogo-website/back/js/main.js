/* ==========================================================================
   carTOGO.mnl — PUBLIC SITE LOGIC (js/main.js)
   Reads content from DB (js/data.js) and renders it into index.html.
   Nothing here writes settings/labels/cars — only visitor inquiries.
   ========================================================================== */

let CARS = [];
let SETTINGS = {};
let LABELS = {};
let activeFilter = "All";
const PICKUP_POINTS = [
  { name: "Pickup point A", lat: 14.718069, lng: 121.040101 },
  { name: "Pickup point B", lat: 14.713487, lng: 121.040112 },
  { name: "Pickup point C", lat: 14.716368, lng: 121.042589 }
];
let BOOKING_MAP = null;
let BOOKING_TARGET = null;
let BOOKING_TARGET_MARKER = null;
let BOOKING_PREVIEW_MARKER = null;
let BOOKING_RATE_QUOTE = null;
let BOOKING_MAP_FULLSCREEN = false;
let BOOKING_GEOCODE_CONTROLLER = null;
let BOOKING_LAST_GEOCODE_AT = 0;
const BOOKING_GEOCODE_CACHE = new Map();

document.addEventListener("DOMContentLoaded", init);

async function init() {
  SETTINGS = await DB.getSettings();
  LABELS = await DB.getLabels();
  CARS = await DB.getCars();

  document.title = SETTINGS.companyName + " — Car Rentals";
  renderBrand();
  renderHero();
  renderTrustStrip();
  renderFilters();
  renderFleet();
  renderHowItWorks();
  renderWhyChooseUs();
  renderRates();
  renderTestimonials();
  renderFaq();
  renderContact();
  renderFooter();
  populateCarSelect();
  bindBookingMap();
  bindNav();
  bindBookingForm();
  bindBookingEstimate();
  bindQuickSearch();
  bindFaqToggles();
  window.addEventListener("storage", handleFleetStorageChange);
}

async function handleFleetStorageChange(event) {
  if (event.key !== STORAGE_KEY && event.key !== null) return;

  [SETTINGS, LABELS, CARS] = await Promise.all([
    DB.getSettings(),
    DB.getLabels(),
    DB.getCars()
  ]);
  if (activeFilter !== "All" && !CARS.some(car => car.category === activeFilter)) {
    activeFilter = "All";
  }
  document.title = SETTINGS.companyName + " — Car Rentals";
  renderBrand();
  renderHero();
  renderTrustStrip();
  renderFilters();
  renderFleet();
  renderHowItWorks();
  renderWhyChooseUs();
  renderRates();
  renderTestimonials();
  renderFaq();
  renderContact();
  renderFooter();
  populateCarSelect();
  renderBookingEstimate();
  bindFaqToggles();
}

/* ---------- Brand / header ---------- */
function renderBrand() {
  document.querySelectorAll("[data-company-name]").forEach(el => {
    el.textContent = SETTINGS.companyName;
  });
}

function finishLoading(element) {
  element.setAttribute("aria-busy", "false");
  element.removeAttribute("aria-label");
}

/* ---------- Hero ---------- */
function renderHero() {
  const title = document.getElementById("heroTitle");
  title.innerHTML = LABELS.hero.title;
  finishLoading(title);
  const subtitle = document.getElementById("heroSubtitle");
  subtitle.textContent = LABELS.hero.subtitle;
  finishLoading(subtitle);
}

/* ---------- Trust strip ---------- */
function renderTrustStrip() {
  const wrap = document.getElementById("trustGrid");
  wrap.innerHTML = LABELS.trustStrip.map(item => {
    const isFleetCount = /^(cars? in our fleet|vehicle options)$/i.test(String(item.label).trim());
    const value = isFleetCount ? CARS.length : item.value;
    return `
    <div class="trust-item">
      <b>${escapeHtml(value)}</b>
      <span>${escapeHtml(item.label)}</span>
    </div>
  `;
  }).join("");
  finishLoading(wrap);
}

/* ---------- Fleet filters ---------- */
function renderFilters() {
  const categories = ["All", ...new Set(CARS.map(c => c.category))];
  const wrap = document.getElementById("filterRow");
  finishLoading(wrap);
  wrap.innerHTML = categories.map(cat => `
    <button class="filter-btn ${cat === activeFilter ? "active" : ""}" data-filter="${escapeHtml(cat)}">${escapeHtml(cat)}</button>
  `).join("");
  wrap.querySelectorAll(".filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      activeFilter = btn.dataset.filter;
      renderFilters();
      renderFleet();
    });
  });
}

/* ---------- Fleet grid ---------- */
function renderFleet() {
  const grid = document.getElementById("fleetGrid");
  finishLoading(grid);
  const list = activeFilter === "All" ? CARS : CARS.filter(c => c.category === activeFilter);

  if (list.length === 0) {
    grid.innerHTML = `<p>No cars in this category right now — check back soon or try another category.</p>`;
    return;
  }

  grid.innerHTML = list.map((car, i) => `
    <article class="car-card" style="animation-delay:${i * 0.05}s">
      <div class="car-media">
        ${car.image
          ? `<img src="${escapeHtml(car.image)}" alt="${escapeHtml(car.name)}">`
          : `<img src="https://placehold.co/480x360/141414/FFFFFF?text=${encodeURIComponent(car.name)}" alt="${escapeHtml(car.name)}">`
        }
        <span class="tag">${escapeHtml(car.category)}</span>
        <span class="avail ${car.available ? "" : "out"}">${escapeHtml(car.status || (car.available ? "Available" : "Unavailable"))}</span>
      </div>
      <div class="car-body">
        <h3>${escapeHtml(car.name)}</h3>
        <div class="car-specs">
          <span><i class="fa-solid fa-user" aria-hidden="true"></i> ${escapeHtml(String(car.seats))} seats</span>
          <span><i class="fa-solid fa-car-side" aria-hidden="true"></i> ${escapeHtml(car.model)}</span>
          ${(car.features || []).map(feature => `<span>${escapeHtml(feature)}</span>`).join("")}
        </div>
        <p class="car-blurb">${car.features?.length ? "Unit features" : "Contact us for unit details."}</p>
        <div class="car-foot">
          <div class="car-rate">
            <b>${formatCurrency(car.in24_rate, SETTINGS.currency)}</b>
            <span>IN / 24 hr</span>
          </div>
          <button class="btn btn-dark btn-sm" ${car.available ? "" : "disabled"} data-reserve="${escapeHtml(car.id)}">
            ${car.available ? "Reserve" : "Unavailable"}
          </button>
        </div>
      </div>
    </article>
  `).join("");

  grid.querySelectorAll("[data-reserve]").forEach(btn => {
    btn.addEventListener("click", () => {
      const carSelect = document.getElementById("bookingCar");
      carSelect.value = btn.dataset.reserve;
      document.getElementById("booking").scrollIntoView({ behavior: "smooth", block: "start" });
      document.getElementById("bookingFirstName").focus({ preventScroll: true });
    });
  });
}

/* ---------- How it works ---------- */
function renderHowItWorks() {
  const wrap = document.getElementById("markersGrid");
  wrap.innerHTML = LABELS.howItWorks.map((step, i) => `
    <div class="marker">
      <div class="num">0${i + 1}</div>
      <h3>${escapeHtml(step.title)}</h3>
      <p>${escapeHtml(step.description)}</p>
    </div>
  `).join("");
  finishLoading(wrap);
}

/* ---------- Why choose us ---------- */
function renderWhyChooseUs() {
  const wrap = document.getElementById("whyGrid");
  wrap.innerHTML = LABELS.whyChooseUs.map(item => `
    <div class="why-item">
      <span class="icon"><i class="fa-solid ${iconClass(item.icon)}" aria-hidden="true"></i></span>
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.description)}</p>
    </div>
  `).join("");
  finishLoading(wrap);
}

/* ---------- Rates table ---------- */
function renderRates() {
  const tbody = document.getElementById("ratesBody");
  tbody.innerHTML = CARS.map(car => `
    <tr>
      <td>${escapeHtml(car.name)}</td>
      <td>${escapeHtml(car.category)}</td>
      <td class="num">${formatCurrency(car.in12_rate, SETTINGS.currency)}</td>
      <td class="num">${formatCurrency(car.in24_rate, SETTINGS.currency)}</td>
      <td class="num">${formatCurrency(car.out12_rate, SETTINGS.currency)}</td>
      <td class="num">${formatCurrency(car.out24_rate, SETTINGS.currency)}</td>
      <td class="num">${formatCurrency(car.luzon_rate, SETTINGS.currency)}</td>
    </tr>
  `).join("");
  finishLoading(tbody);

  const feesGrid = document.getElementById("feesGrid");
  feesGrid.innerHTML = `
    <div class="fee-chip"><b>${formatCurrency(SETTINGS.extraDriverFee, SETTINGS.currency)}</b><span>Extra driver / trip</span></div>
    <div class="fee-chip"><b>${formatCurrency(SETTINGS.childSeatFee, SETTINGS.currency)}</b><span>Child seat / trip</span></div>
    <div class="fee-chip"><b>${formatCurrency(SETTINGS.lateFeePerHour, SETTINGS.currency)}</b><span>Late return / hour</span></div>
    <div class="fee-chip"><b>${SETTINGS.depositPercent}%</b><span>Refundable deposit</span></div>
  `;
  finishLoading(feesGrid);
}

/* ---------- Testimonials ---------- */
function renderTestimonials() {
  const wrap = document.getElementById("testiGrid");
  wrap.innerHTML = LABELS.testimonials.map(t => `
    <div class="testi-card">
      <p class="quote">“${escapeHtml(t.quote)}”</p>
      <div class="who">${escapeHtml(t.name)} — ${escapeHtml(t.detail)}</div>
    </div>
  `).join("");
  finishLoading(wrap);
}

/* ---------- FAQ ---------- */
function renderFaq() {
  const wrap = document.getElementById("faqList");
  wrap.innerHTML = LABELS.faq.map((item, i) => `
    <div class="faq-item" data-index="${i}">
      <button class="faq-q" aria-expanded="false">
        <span>${escapeHtml(item.q)}</span>
        <span class="plus">+</span>
      </button>
      <div class="faq-a"><p>${escapeHtml(item.a)}</p></div>
    </div>
  `).join("");
  finishLoading(wrap);
}

function bindFaqToggles() {
  document.querySelectorAll(".faq-item").forEach(item => {
    item.querySelector(".faq-q").addEventListener("click", () => {
      const isOpen = item.classList.contains("open");
      document.querySelectorAll(".faq-item.open").forEach(el => el.classList.remove("open"));
      if (!isOpen) item.classList.add("open");
    });
  });
}

/* ---------- Contact ---------- */
function renderContact() {
  const c = LABELS.contact;
  document.getElementById("contactPhone").textContent = c.phone;
  document.getElementById("contactEmail").textContent = c.email;
  document.getElementById("contactHours").textContent = c.hours;
  ["contactPhone", "contactEmail", "contactHours"].forEach(id => finishLoading(document.getElementById(id)));
  const locations = document.getElementById("contactLocations");
  locations.innerHTML = c.locations.map(loc => `<li><i class="fa-solid fa-location-dot" aria-hidden="true"></i> ${escapeHtml(loc)}</li>`).join("");
  finishLoading(locations);
}

/* ---------- Footer ---------- */
function renderFooter() {
  const aboutTitle = document.getElementById("footerAboutTitle");
  aboutTitle.textContent = LABELS.about.title;
  finishLoading(aboutTitle);
  const aboutBody = document.getElementById("footerAbout");
  aboutBody.textContent = LABELS.about.body;
  finishLoading(aboutBody);
  document.getElementById("footerYear").textContent = new Date().getFullYear();
  const locations = document.getElementById("footerLocations");
  locations.innerHTML = LABELS.contact.locations
    .map(loc => `<li>${escapeHtml(loc.split("—")[0].trim())}</li>`).join("");
  finishLoading(locations);
}

/* ---------- Booking form select ---------- */
function populateCarSelect() {
  const select = document.getElementById("bookingCar");
  select.innerHTML = `<option value="">Select a car</option>` +
    CARS.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
  select.disabled = false;
  select.classList.remove("skeleton-select");
  finishLoading(select);
}

function distanceBetweenKilometers(first, second) {
  const radians = value => value * Math.PI / 180;
  const latitudeDelta = radians(second.lat - first.lat);
  const longitudeDelta = radians(second.lng - first.lng);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(first.lat)) * Math.cos(radians(second.lat)) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function findNearestPickup(location) {
  return PICKUP_POINTS.map(point => ({
    ...point,
    distanceKm: distanceBetweenKilometers(location, point)
  })).sort((first, second) => first.distanceKm - second.distanceKm)[0];
}

function updateMapDistance(location, prefix = "") {
  const nearest = findNearestPickup(location);
  document.getElementById("bookingMapDistance").textContent = `${prefix}${nearest.distanceKm.toFixed(2)} km distance from the nearest pickup location (${nearest.name})`;
  return nearest;
}

function classifyTargetRegion(address) {
  const normalized = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const addressParts = Object.values(address || {}).filter(value => typeof value === "string").map(normalized);
  const matches = candidates => addressParts.some(part => candidates.some(candidate => part === candidate || part.includes(candidate)));
  const metroManilaNames = [
    "national capital region", "metro manila", "ncr", "caloocan", "las pinas", "makati", "malabon",
    "mandaluyong", "manila", "marikina", "muntinlupa", "navotas", "paranaque", "pasay", "pasig",
    "quezon city", "san juan", "taguig", "valenzuela", "pateros"
  ];
  if (matches(metroManilaNames)) return "in";

  const neighboringProvinces = ["bulacan", "rizal", "cavite", "laguna"];
  if (matches(neighboringProvinces)) return "out";

  const luzonRegionsAndProvinces = [
    "ilocos region", "cagayan valley", "central luzon", "calabarzon", "mimaropa", "bicol region",
    "cordillera administrative region", "luzon", "abra", "albay", "apayao", "aurora", "bataan",
    "batangas", "benguet", "cagayan", "camarines norte", "camarines sur", "catanduanes", "ifugao",
    "ilocos norte", "ilocos sur", "isabela", "kalinga", "la union", "mountain province", "nueva ecija",
    "nueva vizcaya", "occidental mindoro", "oriental mindoro", "palawan", "pampanga", "pangasinan",
    "quezon", "quirino", "romblon", "sorsogon", "tarlac", "zambales"
  ];
  return matches(luzonRegionsAndProvinces) ? "luzon" : null;
}

function regionDisplayName(region) {
  return ({ in: "Metro Manila (IN)", out: "Neighboring areas (OUT)", luzon: "Luzon" })[region] || "Unclassified destination";
}

function setBookingTarget(location) {
  const nearest = findNearestPickup(location);
  BOOKING_TARGET = {
    lat: location.lat,
    lng: location.lng,
    label: `${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}`,
    rateRegion: null,
    nearestPickupName: nearest.name,
    nearestPickupDistanceKm: nearest.distanceKm
  };
  document.getElementById("bookingTargetLat").value = location.lat.toFixed(6);
  document.getElementById("bookingTargetLng").value = location.lng.toFixed(6);
  document.getElementById("bookingTargetLabel").value = BOOKING_TARGET.label;
  document.getElementById("bookingTargetRegion").value = "";
  document.getElementById("bookingNearestPickupName").value = nearest.name;
  document.getElementById("bookingNearestPickupDistance").value = nearest.distanceKm.toFixed(3);
  document.getElementById("bookingTargetStatus").textContent = "Looking up the destination and pricing region...";
  updateMapDistance(location);
  if (BOOKING_TARGET_MARKER) BOOKING_TARGET_MARKER.setLatLng([location.lat, location.lng]);
  else BOOKING_TARGET_MARKER = window.L.marker([location.lat, location.lng]).addTo(BOOKING_MAP);
  renderBookingEstimate();
  resolveBookingTargetRegion(BOOKING_TARGET);
}

async function resolveBookingTargetRegion(target) {
  const cacheKey = `${target.lat.toFixed(4)},${target.lng.toFixed(4)}`;
  let result = BOOKING_GEOCODE_CACHE.get(cacheKey);
  if (!result) {
    BOOKING_GEOCODE_CONTROLLER?.abort();
    BOOKING_GEOCODE_CONTROLLER = new AbortController();
    const waitMs = Math.max(0, 1100 - (Date.now() - BOOKING_LAST_GEOCODE_AT));
    if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
    if (BOOKING_TARGET !== target) return;
    BOOKING_LAST_GEOCODE_AT = Date.now();
    const query = new URLSearchParams({
      format: "jsonv2",
      lat: String(target.lat),
      lon: String(target.lng),
      zoom: "10",
      addressdetails: "1"
    });
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${query}`, {
        headers: { "Accept-Language": "en" },
        signal: BOOKING_GEOCODE_CONTROLLER.signal
      });
      if (!response.ok) throw new Error("Location lookup is temporarily unavailable.");
      const data = await response.json();
      result = {
        label: data.display_name || `${target.lat.toFixed(6)}, ${target.lng.toFixed(6)}`,
        rateRegion: classifyTargetRegion(data.address)
      };
      BOOKING_GEOCODE_CACHE.set(cacheKey, result);
    } catch (error) {
      if (error.name === "AbortError" || BOOKING_TARGET !== target) return;
      document.getElementById("bookingTargetStatus").textContent = "Could not identify this destination. Click a clearer map location and try again.";
      renderBookingEstimate();
      return;
    }
  }

  if (BOOKING_TARGET !== target) return;
  target.label = result.label;
  target.rateRegion = result.rateRegion;
  document.getElementById("bookingTargetLabel").value = target.label;
  document.getElementById("bookingTargetRegion").value = target.rateRegion || "";
  if (target.rateRegion) {
    document.getElementById("bookingTargetStatus").textContent = `${target.label} · ${regionDisplayName(target.rateRegion)} rates`;
  } else {
    document.getElementById("bookingTargetStatus").textContent = `${target.label} · This location isn't in the supported Luzon pricing area.`;
  }
  updateBookingPeriodOptions(target.rateRegion);
  renderBookingEstimate();
}

function updateBookingPeriodOptions(region) {
  const twelveHourOption = document.querySelector('input[name="bookingPeriod"][value="12"]');
  const note = document.getElementById("bookingPeriodNote");
  twelveHourOption.disabled = region === "luzon";
  if (region === "luzon") {
    document.querySelector('input[name="bookingPeriod"][value="24"]').checked = true;
    note.textContent = "The Luzon rate is set as a 24-hour rate.";
    note.hidden = false;
  } else {
    note.hidden = true;
    note.textContent = "";
  }
}

function restoreBookingTargetFromDraft() {
  const latitude = Number(document.getElementById("bookingTargetLat").value);
  const longitude = Number(document.getElementById("bookingTargetLng").value);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !document.getElementById("bookingTargetLabel").value) return;
  const nearest = findNearestPickup({ lat: latitude, lng: longitude });
  BOOKING_TARGET = {
    lat: latitude,
    lng: longitude,
    label: document.getElementById("bookingTargetLabel").value,
    rateRegion: document.getElementById("bookingTargetRegion").value || null,
    nearestPickupName: document.getElementById("bookingNearestPickupName").value || nearest.name,
    nearestPickupDistanceKm: Number(document.getElementById("bookingNearestPickupDistance").value) || nearest.distanceKm
  };
  BOOKING_MAP.setView([latitude, longitude], Math.max(BOOKING_MAP.getZoom(), 13));
  BOOKING_TARGET_MARKER = window.L.marker([latitude, longitude]).addTo(BOOKING_MAP);
  updateMapDistance(BOOKING_TARGET);
  document.getElementById("bookingTargetStatus").textContent = `${BOOKING_TARGET.label} · ${regionDisplayName(BOOKING_TARGET.rateRegion)} rates`;
  updateBookingPeriodOptions(BOOKING_TARGET.rateRegion);
}

function bindBookingMap() {
  const mapElement = document.getElementById("bookingMap");
  if (!window.L) {
    document.getElementById("bookingTargetStatus").textContent = "The map could not load. Refresh the page to try again.";
    return;
  }

  BOOKING_MAP = window.L.map(mapElement, { scrollWheelZoom: false }).setView([14.716, 121.041], 12);
  window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(BOOKING_MAP);

  PICKUP_POINTS.forEach(point => {
    window.L.circleMarker([point.lat, point.lng], {
      radius: 7,
      color: "#7a1f1f",
      weight: 2,
      fillColor: "#d62828",
      fillOpacity: 0.9
    }).addTo(BOOKING_MAP).bindTooltip(point.name);
  });

  BOOKING_MAP.on("mousemove", event => {
    const position = { lat: event.latlng.lat, lng: event.latlng.lng };
    const nearest = findNearestPickup(position);
    document.getElementById("bookingMapDistance").textContent = `${nearest.distanceKm.toFixed(2)} km distance from the nearest pickup location (${nearest.name})`;
    if (BOOKING_PREVIEW_MARKER) BOOKING_PREVIEW_MARKER.setLatLng(event.latlng);
    else BOOKING_PREVIEW_MARKER = window.L.circleMarker(event.latlng, {
      radius: 6,
      color: "#1f5c78",
      weight: 2,
      fillColor: "#ffffff",
      fillOpacity: 0.75
    }).addTo(BOOKING_MAP);
  });
  BOOKING_MAP.on("mouseout", () => {
    if (BOOKING_TARGET) updateMapDistance(BOOKING_TARGET);
    else document.getElementById("bookingMapDistance").textContent = "Move the cursor over the map to preview distance from the nearest pickup point.";
  });
  BOOKING_MAP.on("click", event => setBookingTarget({ lat: event.latlng.lat, lng: event.latlng.lng }));

  const fullscreenButton = document.getElementById("bookingMapFullscreen");
  const setFullscreen = enabled => {
    BOOKING_MAP_FULLSCREEN = enabled;
    document.querySelector(".booking-panel").classList.toggle("is-map-fullscreen", enabled);
    document.body.classList.toggle("has-map-fullscreen", enabled);
    fullscreenButton.setAttribute("aria-pressed", String(enabled));
    fullscreenButton.setAttribute("aria-label", enabled ? "Exit map fullscreen" : "Expand target map to fullscreen");
    fullscreenButton.title = enabled ? "Exit fullscreen" : "Expand map";
    fullscreenButton.innerHTML = `<i class="fa-solid ${enabled ? "fa-compress" : "fa-expand"}" aria-hidden="true"></i>`;
    window.requestAnimationFrame(() => BOOKING_MAP.invalidateSize());
  };
  fullscreenButton.addEventListener("click", () => setFullscreen(!BOOKING_MAP_FULLSCREEN));
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && BOOKING_MAP_FULLSCREEN) setFullscreen(false);
  });

  document.getElementById("bookingForm").addEventListener("reset", () => {
    window.setTimeout(() => {
      BOOKING_TARGET = null;
      BOOKING_RATE_QUOTE = null;
      BOOKING_GEOCODE_CONTROLLER?.abort();
      BOOKING_TARGET_MARKER?.remove();
      BOOKING_TARGET_MARKER = null;
      ["bookingTargetLat", "bookingTargetLng", "bookingTargetLabel", "bookingTargetRegion", "bookingNearestPickupName", "bookingNearestPickupDistance"].forEach(id => {
        document.getElementById(id).value = "";
      });
      document.getElementById("bookingTargetStatus").textContent = "Click the map to choose your target location.";
      document.getElementById("bookingMapDistance").textContent = "Move the cursor over the map to preview distance from the nearest pickup point.";
      updateBookingPeriodOptions(null);
      BOOKING_MAP.setView([14.716, 121.041], 12);
      renderBookingEstimate();
    }, 0);
  });
}

function renderBookingEstimate() {
  const estimate = document.querySelector(".booking-estimate");
  const car = CARS.find(item => item.id === document.getElementById("bookingCar").value);
  const pickup = document.getElementById("bookingPickup").value;
  const returnDate = document.getElementById("bookingReturn").value;
  const region = BOOKING_TARGET?.rateRegion;
  estimate.hidden = !(car && pickup && returnDate && region);
  BOOKING_RATE_QUOTE = null;
  if (!car || !pickup || !returnDate || !region) return;

  const summary = document.getElementById("bookingEstimateSummary");
  const subtotal = document.getElementById("bookingRentalSubtotal");
  const deposit = document.getElementById("bookingDepositEstimate");
  const depositPercent = Number(SETTINGS.depositPercent) || 0;
  document.getElementById("bookingDepositPercent").textContent = depositPercent;
  const toUtcDay = value => {
    const [year, month, day] = value.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };
  const elapsedDays = Math.ceil((toUtcDay(returnDate) - toUtcDay(pickup)) / 86400000);
  if (elapsedDays < 0) {
    summary.textContent = "Return date must be the same day or later than pickup.";
    subtotal.textContent = "—";
    deposit.textContent = "—";
    return;
  }

  const selectedPeriod = Number(document.querySelector('input[name="bookingPeriod"]:checked')?.value || 24);
  const periodHours = region === "luzon" ? 24 : selectedPeriod;
  const rateField = region === "in"
    ? periodHours === 12 ? "in12_rate" : "in24_rate"
    : region === "out"
      ? periodHours === 12 ? "out12_rate" : "out24_rate"
      : "luzon_rate";
  const rate = Number(car[rateField]);
  const rentalHours = Math.max(periodHours, elapsedDays * 24);
  const rateBlocks = Math.max(1, Math.ceil(rentalHours / periodHours));
  const rentalSubtotal = rate * rateBlocks;
  BOOKING_RATE_QUOTE = { rateRegion: region, periodHours, rentalHours, rateBlocks, unitRate: rate, total: rentalSubtotal };
  const regionLabel = region === "in" ? "IN" : region === "out" ? "OUT" : "Luzon";
  summary.textContent = `${rateBlocks} × ${periodHours}-hour ${regionLabel} rate · ${BOOKING_TARGET.nearestPickupDistanceKm.toFixed(2)} km from ${BOOKING_TARGET.nearestPickupName}`;
  subtotal.textContent = formatCurrency(rentalSubtotal, SETTINGS.currency);
  deposit.textContent = formatCurrency(Math.round(rentalSubtotal * depositPercent / 100), SETTINGS.currency);
}

function bindBookingEstimate() {
  ["bookingCar", "bookingPickup", "bookingReturn"].forEach(id => {
    document.getElementById(id).addEventListener("change", renderBookingEstimate);
  });
  document.querySelectorAll('input[name="bookingPeriod"]').forEach(input => input.addEventListener("change", renderBookingEstimate));
  ["bookingLastName", "bookingFirstName"].forEach(id => {
    document.getElementById(id).addEventListener("input", renderBookingEstimate);
  });
  document.getElementById("bookingForm").addEventListener("reset", () => {
    window.setTimeout(renderBookingEstimate, 0);
  });
  renderBookingEstimate();
}

/* ---------- Nav (mobile toggle + smooth focus) ---------- */
function bindNav() {
  const header = document.getElementById("siteHeader");
  const toggle = document.getElementById("navToggle");
  toggle.addEventListener("click", () => header.classList.toggle("open"));
  document.querySelectorAll(".nav-links a").forEach(link => {
    link.addEventListener("click", () => header.classList.remove("open"));
  });
}

/* ---------- Quick search (hero) → scrolls to fleet, copies dates to booking form ---------- */
function bindQuickSearch() {
  const form = document.getElementById("quickSearchForm");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const pickup = document.getElementById("qsPickup").value;
    const ret = document.getElementById("qsReturn").value;
    if (pickup) document.getElementById("bookingPickup").value = pickup;
    if (ret) document.getElementById("bookingReturn").value = ret;
    renderBookingEstimate();
    document.getElementById("fleet").scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

/* ---------- Booking / inquiry form ---------- */
function bindBookingForm() {
  const form = document.getElementById("bookingForm");
  const msg = document.getElementById("formMsg");
  const googleButton = document.getElementById("googleOrderButton");
  const authStatus = document.getElementById("bookingAuthStatus");
  const submitButton = form.querySelector("[type=submit]");
  const draftKey = "cartogo.bookingDraft";
  const signInPendingKey = "cartogo.customerGoogleSignInPending";
  const authToast = document.getElementById("authToast");
  const recapDialog = document.getElementById("reservationRecap");
  const recapCloseButton = document.getElementById("recapCloseButton");
  const recapEditButton = document.getElementById("recapEditButton");
  const recapConfirmButton = document.getElementById("recapConfirmButton");
  const recapError = document.getElementById("recapError");
  let currentUser = null;
  let pendingInquiry = null;
  let isSendingInquiry = false;

  const hasVerifiedGoogleAccount = user => user?.app_metadata?.provider === "google"
    && (user.user_metadata?.email_verified === true || user.user_metadata?.email_verified === "true");
  const updateVerificationUI = () => {
    const isGoogle = hasVerifiedGoogleAccount(currentUser);
    googleButton.hidden = isGoogle;
    if (isGoogle) {
      authStatus.textContent = `Signed in as ${currentUser.email}. Google verified this email.`;
      if (sessionStorage.getItem(signInPendingKey) === "true") {
        sessionStorage.removeItem(signInPendingKey);
        authToast.textContent = "Signed in successfully.";
        authToast.classList.add("show");
        clearTimeout(authToast.hideTimeout);
        authToast.hideTimeout = setTimeout(() => authToast.classList.remove("show"), 3000);
      }
    } else {
      authStatus.textContent = "Sign in with Google to send your inquiry.";
    }
  };

  const restoreDraft = () => {
    const rawDraft = sessionStorage.getItem(draftKey);
    if (!rawDraft) return;
    try {
      const draft = JSON.parse(rawDraft);
      for (const [id, value] of Object.entries(draft)) {
        const input = document.getElementById(id);
        if (!input) continue;
        if (input.type === "radio") input.checked = value === true;
        else if (typeof value === "string") input.value = value;
      }
      restoreBookingTargetFromDraft();
    } catch {
      sessionStorage.removeItem(draftKey);
    }
  };

  const saveDraft = () => {
    const draft = {};
    form.querySelectorAll("input, select, textarea").forEach(input => {
      if (input.id) draft[input.id] = input.type === "radio" ? input.checked : input.value;
    });
    sessionStorage.setItem(draftKey, JSON.stringify(draft));
  };

  const collectInquiry = () => {
    const lastName = document.getElementById("bookingLastName").value.trim();
    const firstName = document.getElementById("bookingFirstName").value.trim();
    const middleName = document.getElementById("bookingMiddleName").value.trim();
    const nameExtension = document.getElementById("bookingSuffix").value.trim();
    const nameParts = [lastName, firstName, middleName].filter(Boolean);
    let name = `${nameParts[0]}, ${nameParts.slice(1).join(" ")}`;
    if (nameExtension) name += `, ${nameExtension}`;
    const carId = document.getElementById("bookingCar").value;
    const car = CARS.find(item => item.id === carId);
    return {
      name,
      carId,
      carName: car ? car.name : "Unknown",
      capacity: document.getElementById("bookingCapacity").value ? Number(document.getElementById("bookingCapacity").value) : null,
      pickupDate: document.getElementById("bookingPickup").value,
      returnDate: document.getElementById("bookingReturn").value,
      location: BOOKING_TARGET?.label || "",
      targetLatitude: BOOKING_TARGET?.lat ?? null,
      targetLongitude: BOOKING_TARGET?.lng ?? null,
      nearestPickupName: BOOKING_TARGET?.nearestPickupName || "",
      nearestPickupDistanceKm: BOOKING_TARGET?.nearestPickupDistanceKm ?? null,
      rateRegion: BOOKING_RATE_QUOTE?.rateRegion || "",
      rentalPeriodHours: BOOKING_RATE_QUOTE?.periodHours ?? null,
      estimatedRentalHours: BOOKING_RATE_QUOTE?.rentalHours ?? null,
      ratePerPeriod: BOOKING_RATE_QUOTE?.unitRate ?? null,
      quotedRate: BOOKING_RATE_QUOTE?.total ?? null,
      notes: document.getElementById("bookingNotes").value.trim()
    };
  };

  const persistInquiry = async (inquiry, options) => {
    await DB.addInquiry({ ...inquiry, ...options });
    sessionStorage.removeItem(draftKey);
    form.reset();
    msg.className = "form-msg success";
    msg.textContent = `Thanks, ${inquiry.name}. Your inquiry is confirmed.`;
    updateVerificationUI();
  };

  const formatRecapDate = value => new Date(`${value}T00:00:00`).toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });

  const openReservationRecap = inquiry => {
    document.getElementById("recapName").textContent = inquiry.name;
    document.getElementById("recapEmail").textContent = currentUser.email;
    document.getElementById("recapCar").textContent = inquiry.carName;
    document.getElementById("recapCapacity").textContent = inquiry.capacity ?? "—";
    document.getElementById("recapPickupDate").textContent = formatRecapDate(inquiry.pickupDate);
    document.getElementById("recapReturnDate").textContent = formatRecapDate(inquiry.returnDate);
    document.getElementById("recapTargetLocation").textContent = inquiry.location;
    document.getElementById("recapNearestPickup").textContent = `${inquiry.nearestPickupDistanceKm.toFixed(2)} km from ${inquiry.nearestPickupName}`;
    document.getElementById("recapRateBasis").textContent = `${regionDisplayName(inquiry.rateRegion)} · ${inquiry.rentalPeriodHours}-hour blocks at ${formatCurrency(inquiry.ratePerPeriod, SETTINGS.currency)}`;
    document.getElementById("recapSubtotal").textContent = document.getElementById("bookingRentalSubtotal").textContent;
    document.getElementById("recapDeposit").textContent = document.getElementById("bookingDepositEstimate").textContent;
    document.getElementById("recapNotes").textContent = inquiry.notes;
    document.getElementById("recapNotesRow").hidden = !inquiry.notes;
    recapError.hidden = true;
    recapError.textContent = "";
    pendingInquiry = { ...inquiry, email: currentUser.email };
    recapDialog.showModal();
  };

  const closeReservationRecap = () => {
    if (isSendingInquiry) return;
    pendingInquiry = null;
    recapDialog.close();
  };

  recapCloseButton.addEventListener("click", closeReservationRecap);
  recapEditButton.addEventListener("click", closeReservationRecap);
  recapDialog.addEventListener("cancel", event => {
    if (isSendingInquiry) event.preventDefault();
  });
  recapDialog.addEventListener("close", () => {
    if (!isSendingInquiry) pendingInquiry = null;
  });
  recapConfirmButton.addEventListener("click", async () => {
    if (!pendingInquiry || isSendingInquiry) return;
    if (!hasVerifiedGoogleAccount(currentUser)) {
      recapError.textContent = "Your Google sign-in is no longer valid. Sign in again before confirming.";
      recapError.hidden = false;
      return;
    }

    isSendingInquiry = true;
    recapConfirmButton.disabled = true;
    recapCloseButton.disabled = true;
    recapEditButton.disabled = true;
    submitButton.disabled = true;
    submitButton.textContent = "Sending…";
    try {
      await persistInquiry(pendingInquiry, {
        userId: currentUser.id,
        verificationMethod: "google_oauth",
        status: "confirmed"
      });
      pendingInquiry = null;
      recapDialog.close();
    } catch (err) {
      console.error(err);
      recapError.textContent = `Could not submit your inquiry: ${err.message || "Please try again."}`;
      recapError.hidden = false;
    } finally {
      isSendingInquiry = false;
      recapConfirmButton.disabled = false;
      recapCloseButton.disabled = false;
      recapEditButton.disabled = false;
      submitButton.disabled = false;
      submitButton.textContent = "Send Inquiry";
    }
  });

  const startGoogleSignIn = async () => {
    saveDraft();
    sessionStorage.setItem(signInPendingKey, "true");
    const { error } = await supa.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: new URL("index.html", window.location.href).href.split("#")[0] }
    });
    if (error) {
      sessionStorage.removeItem(signInPendingKey);
      throw error;
    }
  };

  restoreDraft();
  googleButton.addEventListener("click", async () => {
    googleButton.disabled = true;
    try {
      await startGoogleSignIn();
    } catch (error) {
      msg.className = "form-msg error";
      msg.textContent = `Google sign-in failed: ${error.message}`;
      googleButton.disabled = false;
    }
  });
  supa.auth.getSession().then(({ data, error }) => {
    if (error) {
      authStatus.textContent = "Could not check the current sign-in status.";
      return;
    }
    currentUser = data.session?.user || null;
    if (hasVerifiedGoogleAccount(currentUser)) {
      sessionStorage.removeItem(draftKey);
    } else {
      sessionStorage.removeItem(signInPendingKey);
    }
    updateVerificationUI();
  });
  supa.auth.onAuthStateChange((_event, session) => {
    currentUser = session?.user || null;
    updateVerificationUI();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.className = "form-msg";
    msg.textContent = "";
    const inquiry = collectInquiry();
    const lastName = document.getElementById("bookingLastName").value.trim();
    const firstName = document.getElementById("bookingFirstName").value.trim();

    if (!lastName || !firstName || !inquiry.carId || !inquiry.pickupDate || !inquiry.returnDate) {
      msg.className = "form-msg error";
      msg.textContent = "Please fill in your name, car, and both dates.";
      return;
    }
    if (!BOOKING_TARGET) {
      msg.className = "form-msg error";
      msg.textContent = "Choose your target location on the map before continuing.";
      document.getElementById("bookingMap").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (!BOOKING_TARGET.rateRegion || !BOOKING_RATE_QUOTE) {
      msg.className = "form-msg error";
      msg.textContent = "We couldn't verify a rate for this destination. Choose a location within the supported Luzon pricing area.";
      return;
    }
    if (new Date(inquiry.returnDate) < new Date(inquiry.pickupDate)) {
      msg.className = "form-msg error";
      msg.textContent = "Return date can't be earlier than the pickup date.";
      return;
    }
    if (inquiry.capacity !== null && (!Number.isInteger(inquiry.capacity) || inquiry.capacity < 1)) {
      msg.className = "form-msg error";
      msg.textContent = "Capacity must be a whole number greater than zero.";
      return;
    }
    if (!hasVerifiedGoogleAccount(currentUser)) {
      msg.className = "form-msg error";
      msg.textContent = "Sign in with Google before sending your inquiry.";
      googleButton.focus();
      return;
    }
    openReservationRecap(inquiry);
  });

  updateVerificationUI();
}

/* ---------- Utility ---------- */
function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function iconClass(name) {
  const icons = {
    user: "fa-user", gear: "fa-gear", fuel: "fa-gas-pump",
    location: "fa-location-dot", car: "fa-car-side", calendar: "fa-calendar-days",
    clipboard: "fa-clipboard-list", card: "fa-credit-card", phone: "fa-phone",
    key: "fa-key", shield: "fa-shield-halved"
  };
  return icons[name] || "fa-circle-info";
}

