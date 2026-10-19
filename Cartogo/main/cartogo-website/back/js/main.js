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
let BOOKING_DURATION_SELECTED = false;
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
          <div class="car-rate"><span>Choose this unit in the booking form to view rates.</span></div>
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
      const car = CARS.find(item => item.id === btn.dataset.reserve);
      if (car) {
        document.getElementById("bookingCapacity").value = String(car.seats);
        populateCarSelect(car.id);
        renderRates();
        renderBookingEstimate();
      }
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
  const selectedId = document.getElementById("bookingCar")?.value;
  const car = CARS.find(item => item.id === selectedId);
  if (!car) {
    tbody.innerHTML = `<tr><td class="rates-empty" colspan="7">Choose a unit in Booking Details to view its rates.</td></tr>`;
  } else {
    tbody.innerHTML = `
      <tr>
        <td>${escapeHtml(car.name)}</td>
        <td>${escapeHtml(car.category)}</td>
        <td class="num">${formatCurrency(car.in12_rate, SETTINGS.currency)}</td>
        <td class="num">${formatCurrency(car.in24_rate, SETTINGS.currency)}</td>
        <td class="num">${formatCurrency(car.out12_rate, SETTINGS.currency)}</td>
        <td class="num">${formatCurrency(car.out24_rate, SETTINGS.currency)}</td>
        <td class="num">${formatCurrency(car.luzon_rate, SETTINGS.currency)}</td>
      </tr>
    `;
  }
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
function populateCarSelect(preferredId = null) {
  const select = document.getElementById("bookingCar");
  const selectedId = preferredId || select.value;
  const requestedCapacity = Number(document.getElementById("bookingCapacity").value);
  const matchingCars = Number.isInteger(requestedCapacity) && requestedCapacity > 0
    ? CARS.filter(car => Number(car.seats) >= requestedCapacity)
    : CARS;
  select.innerHTML = `<option value="">Select a car</option>` +
    matchingCars.map(car => `<option value="${escapeHtml(car.id)}">${escapeHtml(car.name)}</option>`).join("");
  if (matchingCars.some(car => car.id === selectedId)) select.value = selectedId;
  if (matchingCars.length === 0) {
    select.options[0].textContent = "No units available";
  }
  select.disabled = false;
  select.classList.remove("skeleton-select");
  finishLoading(select);
  if (!select.value) renderRates();
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
  updateMapDistance(location, "Selected: ");
  BOOKING_PREVIEW_MARKER?.remove();
  BOOKING_PREVIEW_MARKER = null;
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
  const periodField = document.getElementById("bookingPeriodField");
  const periodOptions = document.querySelectorAll('input[name="bookingPeriod"]');
  const note = document.getElementById("bookingPeriodNote");
  const isLuzon = region === "luzon";
  periodField.hidden = false;
  periodField.classList.toggle("luzon-rate", isLuzon);
  periodOptions.forEach(option => {
    option.required = !isLuzon;
    option.disabled = false;
    if (isLuzon) option.checked = false;
  });
  if (isLuzon) {
    note.textContent = "Luzon pricing uses a 24-hour rate; choose a rental duration below.";
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
  updateMapDistance(BOOKING_TARGET, "Selected: ");
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
    if (BOOKING_TARGET) return;
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
    if (BOOKING_TARGET) updateMapDistance(BOOKING_TARGET, "Selected: ");
    else document.getElementById("bookingMapDistance").textContent = "Move the cursor over the map to preview distance from the nearest pickup point.";
  });
  BOOKING_MAP.on("click", event => setBookingTarget({ lat: event.latlng.lat, lng: event.latlng.lng }));

  const fullscreenButton = document.getElementById("bookingMapFullscreen");
  const bookingPanel = document.querySelector(".booking-panel");
  let fullscreenAnimationTimer = null;
  const setFullscreen = enabled => {
    BOOKING_MAP_FULLSCREEN = enabled;
    clearTimeout(fullscreenAnimationTimer);
    bookingPanel.classList.remove("is-map-fullscreen-closing");
    bookingPanel.classList.toggle("is-map-fullscreen", enabled);
    if (!enabled) {
      bookingPanel.classList.add("is-map-fullscreen-closing");
      fullscreenAnimationTimer = window.setTimeout(() => {
        bookingPanel.classList.remove("is-map-fullscreen-closing");
      }, 240);
    }
    document.body.classList.toggle("has-map-fullscreen", enabled);
    fullscreenButton.setAttribute("aria-pressed", String(enabled));
    fullscreenButton.setAttribute("aria-label", enabled ? "Exit map fullscreen" : "Expand target map to fullscreen");
    fullscreenButton.title = enabled ? "Exit fullscreen" : "Expand map";
    fullscreenButton.classList.toggle("is-expanded", enabled);
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
      document.getElementById("bookingRentalDaysValue").textContent = `${document.getElementById("bookingRentalDays").value} days`;
      document.getElementById("bookingPromoMessage").textContent = `Enjoy ${Number(document.getElementById("bookingRentalDays").value) >= 8 ? 10 : 5}% off by selecting ${document.getElementById("bookingRentalDays").value} days.`;
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
  const discountRow = document.getElementById("bookingDiscountRow");
  const discountAmount = document.getElementById("bookingDiscountAmount");
  const depositPercent = Number(SETTINGS.depositPercent) || 0;
  document.getElementById("bookingDepositPercent").textContent = depositPercent;
  if (!BOOKING_DURATION_SELECTED) {
    summary.textContent = "Choose a rental contract length to see your quote.";
    subtotal.textContent = "—";
    deposit.textContent = "—";
    discountRow.hidden = true;
    return;
  }
  const toUtcDay = value => {
    const [year, month, day] = value.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };
  const elapsedDays = (toUtcDay(returnDate) - toUtcDay(pickup)) / 86400000;
  const rentalDays = Number(document.getElementById("bookingRentalDays").value);
  if (!Number.isInteger(elapsedDays) || elapsedDays !== rentalDays || rentalDays < 4 || rentalDays > 15) {
    summary.textContent = "Set a valid pickup date and 4–15 day rental duration.";
    subtotal.textContent = "—";
    deposit.textContent = "—";
    discountRow.hidden = true;
    return;
  }

  const selectedPeriod = Number(document.querySelector('input[name="bookingPeriod"]:checked')?.value || 0);
  if (region !== "luzon" && selectedPeriod !== 12 && selectedPeriod !== 24) {
    estimate.hidden = false;
    summary.textContent = "Choose a 12- or 24-hour rental period to see your quote.";
    subtotal.textContent = "—";
    deposit.textContent = "—";
    discountRow.hidden = true;
    return;
  }
  const promoPercent = rentalDays >= 8 ? 10 : 5;
  document.getElementById("bookingPromoMessage").textContent = region !== "luzon" && selectedPeriod === 12
    ? `Enjoy ${promoPercent}% off by selecting ${rentalDays} days on 24-hour rates.`
    : `Enjoy ${promoPercent}% off by selecting ${rentalDays} days.`;
  const periodHours = region === "luzon" ? 24 : selectedPeriod;
  const rateField = region === "in"
    ? periodHours === 12 ? "in12_rate" : "in24_rate"
    : region === "out"
      ? periodHours === 12 ? "out12_rate" : "out24_rate"
      : "luzon_rate";
  const rate = Number(car[rateField]);
  const rentalHours = rentalDays * 24;
  const rateBlocks = rentalHours / periodHours;
  const undiscountedSubtotal = rate * rateBlocks;
  const discountPercent = periodHours === 24 ? (rentalDays >= 8 ? 10 : 5) : 0;
  const promoDiscount = Math.round(undiscountedSubtotal * discountPercent) / 100;
  const rentalSubtotal = undiscountedSubtotal - promoDiscount;
  BOOKING_RATE_QUOTE = {
    rateRegion: region,
    periodHours,
    rentalHours,
    rentalDays,
    rateBlocks,
    unitRate: rate,
    discountPercent,
    discountAmount: promoDiscount,
    total: rentalSubtotal
  };
  const regionLabel = region === "in" ? "IN" : region === "out" ? "OUT" : "Luzon";
  summary.textContent = `${rentalDays} days · ${rateBlocks} × ${periodHours}-hour ${regionLabel} rate at ${formatCurrency(rate, SETTINGS.currency)}${discountPercent ? ` · ${discountPercent}% promo` : ""}`;
  subtotal.textContent = formatCurrency(rentalSubtotal, SETTINGS.currency);
  discountRow.hidden = discountPercent === 0;
  discountAmount.textContent = `−${formatCurrency(promoDiscount, SETTINGS.currency)}`;
  deposit.textContent = formatCurrency(Math.round(rentalSubtotal * depositPercent / 100), SETTINGS.currency);
}

function bindBookingEstimate() {
  const capacityInput = document.getElementById("bookingCapacity");
  const carSelect = document.getElementById("bookingCar");
  const pickupInput = document.getElementById("bookingPickup");
  const returnInput = document.getElementById("bookingReturn");
  const daysInput = document.getElementById("bookingRentalDays");
  const daysOutput = document.getElementById("bookingRentalDaysValue");
  const promoMessage = document.getElementById("bookingPromoMessage");
  const durationDetails = document.getElementById("bookingDurationDetails");
  const durationSummary = document.getElementById("bookingDurationSummary");
  const hoverCanExpand = window.matchMedia("(hover: hover) and (pointer: fine)");
  let durationPinnedOpen = false;
  let durationHovering = false;

  const setDurationOpen = open => {
    durationDetails.open = open;
    durationSummary.setAttribute("aria-expanded", String(open));
  };
  const closeDuration = () => {
    durationPinnedOpen = false;
    durationHovering = false;
    document.getElementById("bookingPeriodField").classList.remove("duration-touch-open");
    setDurationOpen(false);
  };
  const updateDurationPromo = () => {
    const days = Number(daysInput.value);
    const percentage = days >= 8 ? 10 : 5;
    const selectedPeriod = document.querySelector('input[name="bookingPeriod"]:checked')?.value;
    durationDetails.classList.toggle("duration-unselected", !BOOKING_DURATION_SELECTED);
    daysOutput.textContent = BOOKING_DURATION_SELECTED ? `${days} days` : "--";
    promoMessage.textContent = selectedPeriod === "12"
      ? `Enjoy ${percentage}% off by selecting ${days} days on 24-hour rates.`
      : BOOKING_DURATION_SELECTED
        ? `Enjoy ${percentage}% off by selecting ${days} days.`
        : "Choose 4–7 days for 5% off or 8–15 days for 10% off.";
  };
  const clearSelectedPeriod = () => {
    const checkedPeriod = document.querySelector('input[name="bookingPeriod"]:checked');
    if (!checkedPeriod) return;
    checkedPeriod.checked = false;
    updateDurationPromo();
    renderBookingEstimate();
  };
  const resetDurationForPeriodChange = () => {
    daysInput.value = "4";
    BOOKING_DURATION_SELECTED = false;
    closeDuration();
    syncReturnDate();
  };

  durationSummary.setAttribute("aria-expanded", "false");
  durationSummary.addEventListener("click", event => {
    event.preventDefault();
    clearSelectedPeriod();
    durationPinnedOpen = !durationPinnedOpen;
    const durationOpen = durationPinnedOpen || durationHovering;
    if (!hoverCanExpand.matches) {
      document.getElementById("bookingPeriodField").classList.toggle("duration-touch-open", durationOpen);
    }
    setDurationOpen(durationOpen);
  });
  durationDetails.addEventListener("pointerenter", event => {
    if (!hoverCanExpand.matches || event.pointerType === "touch") return;
    durationHovering = true;
    document.getElementById("bookingPeriodField").classList.add("duration-hovering");
    setDurationOpen(true);
  });
  durationDetails.addEventListener("pointerleave", () => {
    durationHovering = false;
    document.getElementById("bookingPeriodField").classList.remove("duration-hovering");
    if (!durationPinnedOpen) setDurationOpen(false);
  });

  capacityInput.addEventListener("input", () => {
    const selectedId = carSelect.value;
    populateCarSelect();
    if (carSelect.value !== selectedId) renderBookingEstimate();
  });
  carSelect.addEventListener("change", () => {
    renderRates();
    renderBookingEstimate();
  });
  const syncReturnDate = () => {
    const pickup = pickupInput.value;
    const days = Number(daysInput.value);
    updateDurationPromo();
    if (pickup) {
      const [year, month, day] = pickup.split("-").map(Number);
      const returnDate = new Date(Date.UTC(year, month - 1, day + days));
      returnInput.value = returnDate.toISOString().slice(0, 10);
      returnInput.min = pickup;
    } else {
      returnInput.value = "";
    }
    renderBookingEstimate();
  };
  pickupInput.addEventListener("change", syncReturnDate);
  daysInput.addEventListener("input", () => {
    BOOKING_DURATION_SELECTED = true;
    syncReturnDate();
  });
  daysInput.addEventListener("click", () => {
    clearSelectedPeriod();
    BOOKING_DURATION_SELECTED = true;
    updateDurationPromo();
    renderBookingEstimate();
  });
  document.querySelectorAll('input[name="bookingPeriod"]').forEach(input => {
    input.addEventListener("change", resetDurationForPeriodChange);
    input.addEventListener("click", () => {
      if (input.checked) {
        window.setTimeout(() => {
          if (input.checked) resetDurationForPeriodChange();
        }, 0);
      }
    });
  });
  ["bookingLastName", "bookingFirstName"].forEach(id => {
    document.getElementById(id).addEventListener("input", renderBookingEstimate);
  });
  document.getElementById("bookingForm").addEventListener("reset", () => {
    window.setTimeout(() => {
      BOOKING_DURATION_SELECTED = false;
      updateDurationPromo();
      closeDuration();
      updateBookingPeriodOptions(null);
      populateCarSelect();
      renderRates();
      renderBookingEstimate();
    }, 0);
  });
  BOOKING_DURATION_SELECTED = false;
  syncReturnDate();
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
    const daysInput = document.getElementById("bookingRentalDays");
    if (pickup && ret) {
      const [startYear, startMonth, startDay] = pickup.split("-").map(Number);
      const [endYear, endMonth, endDay] = ret.split("-").map(Number);
      const days = (Date.UTC(endYear, endMonth - 1, endDay) - Date.UTC(startYear, startMonth - 1, startDay)) / 86400000;
      if (Number.isInteger(days) && days >= 4 && days <= 15) daysInput.value = String(days);
    }
    daysInput.dispatchEvent(new Event("input", { bubbles: true }));
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
        if (id === "bookingDurationChosen") {
          BOOKING_DURATION_SELECTED = value === true;
          continue;
        }
        const input = document.getElementById(id);
        if (!input) continue;
        if (input.type === "radio") input.checked = value === true;
        else if (typeof value === "string") input.value = value;
      }
      populateCarSelect();
      renderRates();
      restoreBookingTargetFromDraft();
      renderBookingEstimate();
    } catch {
      sessionStorage.removeItem(draftKey);
    }
  };

  const saveDraft = () => {
    const draft = {};
    form.querySelectorAll("input, select, textarea").forEach(input => {
      if (input.id) draft[input.id] = input.type === "radio" ? input.checked : input.value;
    });
    draft.bookingDurationChosen = BOOKING_DURATION_SELECTED;
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
      pickupTime: document.getElementById("bookingPickupTime").value,
      location: BOOKING_TARGET?.label || "",
      targetLatitude: BOOKING_TARGET?.lat ?? null,
      targetLongitude: BOOKING_TARGET?.lng ?? null,
      nearestPickupName: BOOKING_TARGET?.nearestPickupName || "",
      nearestPickupDistanceKm: BOOKING_TARGET?.nearestPickupDistanceKm ?? null,
      rateRegion: BOOKING_RATE_QUOTE?.rateRegion || "",
      rentalPeriodHours: BOOKING_RATE_QUOTE?.periodHours ?? null,
      estimatedRentalHours: BOOKING_RATE_QUOTE?.rentalHours ?? null,
      ratePerPeriod: BOOKING_RATE_QUOTE?.unitRate ?? null,
      rentalDays: BOOKING_RATE_QUOTE?.rentalDays ?? null,
      discountPercent: BOOKING_RATE_QUOTE?.discountPercent ?? null,
      discountAmount: BOOKING_RATE_QUOTE?.discountAmount ?? null,
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
    document.getElementById("recapPickupTime").textContent = inquiry.pickupTime;
    document.getElementById("recapReturnDate").textContent = formatRecapDate(inquiry.returnDate);
    document.getElementById("recapTargetLocation").textContent = inquiry.location;
    document.getElementById("recapNearestPickup").textContent = `${inquiry.nearestPickupDistanceKm.toFixed(2)} km from ${inquiry.nearestPickupName}`;
    document.getElementById("recapRateBasis").textContent = `${regionDisplayName(inquiry.rateRegion)} · ${inquiry.rentalPeriodHours}-hour blocks at ${formatCurrency(inquiry.ratePerPeriod, SETTINGS.currency)}`;
    document.getElementById("recapRentalDays").textContent = `${inquiry.rentalDays} days`;
    document.getElementById("recapDiscountRow").hidden = !inquiry.discountPercent;
    document.getElementById("recapDiscount").textContent = inquiry.discountPercent
      ? `${inquiry.discountPercent}% · −${formatCurrency(inquiry.discountAmount, SETTINGS.currency)}`
      : "No discount for 12-hour pricing";
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

    if (!lastName || !firstName || !inquiry.carId || !inquiry.pickupDate || !inquiry.pickupTime || !inquiry.returnDate) {
      msg.className = "form-msg error";
      msg.textContent = "Please fill in your name, car, pickup date, pickup time, and rental duration.";
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
    if (BOOKING_TARGET.rateRegion !== "luzon"
      && !document.querySelector('input[name="bookingPeriod"]:checked')) {
      msg.className = "form-msg error";
      msg.textContent = "Choose either the 12-hour or 24-hour rental period.";
      document.getElementById("bookingPeriodField").scrollIntoView({ behavior: "smooth", block: "center" });
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
