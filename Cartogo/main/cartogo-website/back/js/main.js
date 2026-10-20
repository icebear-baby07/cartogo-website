/* ==========================================================================
   carTOGO.mnl — PUBLIC SITE LOGIC (js/main.js)
   Reads content from DB (js/data.js) and renders it into index.html.
   Nothing here writes settings/labels/cars — only visitor inquiries.
   ========================================================================== */

let CARS = [];
let SETTINGS = {};
let LABELS = {};
let SITE_CONTENT = {};
let DISCOUNT_RULES = [];
let SITE_ASSETS = [];
let CONTACT_MAP = null;
let CONTACT_MAP_MARKERS = [];
let CONTACT_MAP_FULLSCREEN = false;
let activeFilter = "All";
const PICKUP_MARKER_COLORS = ["#d62828", "#277da1", "#2f7d46", "#a45a18", "#7556a8", "#087e8b", "#b33f62", "#5b6b27"];
let PICKUP_POINTS = [];
let BOOKING_MAP = null;
let BOOKING_PICKUP_MARKERS = [];
let BOOKING_TARGET = null;
let BOOKING_TARGET_MARKER = null;
let BOOKING_PREVIEW_MARKER = null;
let BOOKING_RATE_QUOTE = null;
let BOOKING_MAP_FULLSCREEN = false;
let BOOKING_DURATION_SELECTED = false;
let BOOKING_GEOCODE_CONTROLLER = null;
let BOOKING_LAST_GEOCODE_AT = 0;
const BOOKING_GEOCODE_CACHE = new Map();

document.addEventListener("DOMContentLoaded", async () => {
  try {
    await init();
  } catch (error) {
    console.error("The public site could not load its MongoDB data.", error);
    const notice = document.createElement("div");
    notice.className = "site-data-error";
    notice.setAttribute("role", "alert");
    notice.textContent = "Site data is temporarily unavailable. Please try again later.";
    document.body.prepend(notice);
  }
});

async function init() {
  SITE_CONTENT = await DB.getSiteContent();
  SETTINGS = SITE_CONTENT.settings;
  LABELS = SITE_CONTENT.labels;
  DISCOUNT_RULES = SITE_CONTENT.discountRules || [];
  CARS = await DB.getCars();
  SITE_ASSETS = await DB.getSiteAssets();
  const configuredPickupPoints = SITE_ASSETS
    .filter(asset => asset.asset_type === "location")
    .map((asset, index) => ({
      name: asset.loc_name || asset.display_name,
      lat: Number(asset.coordinates?.lat),
      lng: Number(asset.coordinates?.lng),
      status: asset.status || "open",
      color: asset.status === "closed" ? "#71717a" : PICKUP_MARKER_COLORS[index % PICKUP_MARKER_COLORS.length]
    }))
    .filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lng));
  if (configuredPickupPoints.length) PICKUP_POINTS = configuredPickupPoints;

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
  bindContactMap();
  bindNav();
  bindBookingForm();
  bindBookingEstimate();
  bindQuickSearch();
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
      const firstNameField = document.getElementById("bookingFirstNameField");
      document.getElementById(firstNameField.hidden ? "bookingCar" : "bookingFirstName").focus({ preventScroll: true });
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
  const publicCars = CARS.filter(car => car.status !== "Inactive");
  tbody.innerHTML = publicCars.length
    ? publicCars.map(car => `
      <tr>
        <td>${escapeHtml(car.name)}</td>
        <td>${escapeHtml(car.category)}</td>
        <td class="num">${escapeHtml(formatCurrency(car.in12_rate, SETTINGS.currency))}</td>
        <td class="num">${escapeHtml(formatCurrency(car.in24_rate, SETTINGS.currency))}</td>
        <td class="num">${escapeHtml(formatCurrency(car.out12_rate, SETTINGS.currency))}</td>
        <td class="num">${escapeHtml(formatCurrency(car.out24_rate, SETTINGS.currency))}</td>
        <td class="num">${escapeHtml(formatCurrency(car.luzon_rate, SETTINGS.currency))}</td>
      </tr>
    `).join("")
    : `<tr><td class="rates-empty" colspan="7">No units are currently listed. Contact our team for availability.</td></tr>`;
  finishLoading(tbody);

  const feesGrid = document.getElementById("feesGrid");
  const feeItems = [
    { value: formatCurrency(SETTINGS.extraDriverFee, SETTINGS.currency), label: "Extra driver / trip", detail: "A per-trip charge for adding an authorized driver." },
    { value: formatCurrency(SETTINGS.childSeatFee, SETTINGS.currency), label: "Child seat / trip", detail: "A per-trip charge for a child seat; request one with your inquiry." },
    { value: formatCurrency(SETTINGS.lateFeePerHour, SETTINGS.currency), label: "Late return / hour", detail: "Charged for each hour past the scheduled return time." },
    { value: `${SETTINGS.depositPercent}%`, label: "Refundable deposit", detail: "The displayed percentage is an estimate of the refundable deposit." }
  ];
  feesGrid.innerHTML = feeItems.map((item, index) => `
    <button class="fee-chip" type="button" aria-expanded="false" aria-controls="feeChipDetail${index}" aria-label="${escapeHtml(item.label)}: ${escapeHtml(item.value)}">
      <b>${escapeHtml(item.value)}</b>
      <span>${escapeHtml(item.label)}</span>
      <span class="fee-chip-detail" id="feeChipDetail${index}" hidden>${escapeHtml(item.detail)}</span>
    </button>
  `).join("");
  feesGrid.querySelectorAll(".fee-chip").forEach(chip => {
    let pointerInside = false;
    let clickState = null;
    const updateExpandedState = () => {
      const isExpanded = clickState === null ? pointerInside || chip.matches(":focus-visible") : clickState;
      const detail = chip.querySelector(".fee-chip-detail");
      chip.classList.toggle("is-expanded", isExpanded);
      chip.setAttribute("aria-expanded", String(isExpanded));
      chip.style.zIndex = isExpanded ? "20" : "";
      detail.hidden = !isExpanded;
      chip.style.borderColor = isExpanded ? "var(--signal)" : "";
      chip.style.backgroundColor = isExpanded ? "#fff8f6" : "";
    };
    chip.addEventListener("pointerenter", () => {
      pointerInside = true;
      if (clickState === false) clickState = null;
      updateExpandedState();
    });
    chip.addEventListener("pointerleave", () => {
      pointerInside = false;
      if (clickState === false) clickState = null;
      updateExpandedState();
    });
    chip.addEventListener("focusin", () => {
      if (clickState === false) clickState = null;
      updateExpandedState();
    });
    chip.addEventListener("focusout", event => {
      if (!(event.relatedTarget instanceof Element) || !chip.contains(event.relatedTarget)) {
        if (clickState === false) clickState = null;
        updateExpandedState();
      }
    });
    chip.addEventListener("click", () => {
      clickState = clickState === null ? true : !clickState;
      updateExpandedState();
    });
  });
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
  const savedContact = SITE_ASSETS.find(asset => asset.asset_type === "contact");
  const phone = savedContact?.phone || "";
  const email = savedContact?.email || "";
  const hours = savedContact?.operational_hours || "";
  document.getElementById("contactHeading").textContent = `CHAT WITH ${savedContact?.display_name || "LIVE AGENT"}`.toUpperCase();
  const description = document.getElementById("contactDescription");
  description.textContent = savedContact?.description || "";
  description.hidden = !savedContact?.description;
  document.getElementById("contactPhone").textContent = phone;
  document.getElementById("contactPhone").href = `tel:${phone.replace(/[^+\d]/g, "")}`;
  document.getElementById("contactEmail").textContent = email;
  document.getElementById("contactEmail").href = `mailto:${email}`;
  document.getElementById("contactHours").textContent = hours;
  document.getElementById("contactStatus").textContent = savedContact?.status === "closed" ? "Closed" : "Open";
  document.querySelector(".live-agent-card").classList.toggle("is-closed", savedContact?.status === "closed");
  ["contactPhone", "contactEmail", "contactHours"].forEach(id => finishLoading(document.getElementById(id)));
  const locations = document.getElementById("contactLocations");
  const pickupLocations = SITE_ASSETS.filter(asset => asset.asset_type === "location");
  locations.innerHTML = pickupLocations.length
    ? pickupLocations.map(location => `
      <li><button class="contact-location-option" type="button" data-location-id="${escapeHtml(String(location.id))}">
        <i class="fa-solid fa-location-dot" aria-hidden="true"></i>
        <span>${escapeHtml(location.display_name)}</span>
        <small class="${location.status === "closed" ? "is-closed" : ""}">${location.status === "closed" ? "Closed" : "Open"}</small>
      </button></li>
    `).join("")
    : `<li class="contact-location-empty">No pickup locations configured.</li>`;
  finishLoading(locations);
  document.getElementById("contactMapEmpty").hidden = pickupLocations.length > 0;
  renderContactMapMarkers();
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
  renderSocialLinks();
}

function renderSocialLinks() {
  const socialLinks = SITE_CONTENT.socialLinks || [];
  document.querySelectorAll("[data-social]").forEach(link => {
    const social = socialLinks.find(item => item.platform === link.dataset.social);
    const url = typeof social?.url === "string" ? social.url.trim() : "";
    link.title = social?.label || link.getAttribute("aria-label") || "";
    link.setAttribute("aria-label", social?.label || link.getAttribute("aria-label") || "");
    if (/^https:\/\/[^\s]+$/i.test(url)) {
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.removeAttribute("aria-disabled");
      link.removeAttribute("tabindex");
    } else {
      link.removeAttribute("href");
      link.removeAttribute("target");
      link.removeAttribute("rel");
      link.setAttribute("aria-disabled", "true");
      link.tabIndex = -1;
    }
  });
}

function contactLocationColor(location) {
  const index = SITE_ASSETS.filter(asset => asset.asset_type === "location").findIndex(asset => asset.id === location.id);
  return location.status === "closed" ? "#71717a" : PICKUP_MARKER_COLORS[Math.max(index, 0) % PICKUP_MARKER_COLORS.length];
}

function renderContactMapMarkers() {
  if (!CONTACT_MAP) return;
  CONTACT_MAP_MARKERS.forEach(({ marker }) => marker.remove());
  CONTACT_MAP_MARKERS = [];
  const locations = SITE_ASSETS.filter(asset => asset.asset_type === "location");
  locations.forEach(location => {
    const latitude = Number(location.coordinates?.lat);
    const longitude = Number(location.coordinates?.lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    const color = contactLocationColor(location);
    const marker = window.L.marker([latitude, longitude], {
      icon: window.L.divIcon({
        className: "contact-location-marker",
        html: `<i class="fa-solid fa-location-dot" style="--marker-color:${color}" aria-hidden="true"></i>`,
        iconSize: [30, 34],
        iconAnchor: [15, 34]
      })
    }).addTo(CONTACT_MAP);
    const hours = location.opening_hours && location.closing_hours
      ? `${String(location.opening_hours).slice(0, 5)} - ${String(location.closing_hours).slice(0, 5)}`
      : "Hours not listed";
    marker.bindPopup(`<strong>${escapeHtml(location.display_name)}</strong><br>${escapeHtml(location.description || "")}<br>${escapeHtml(hours)} · ${location.status === "closed" ? "Closed" : "Open"}`);
    CONTACT_MAP_MARKERS.push({ location, marker });
  });
  if (CONTACT_MAP_MARKERS.length) {
    CONTACT_MAP.fitBounds(window.L.featureGroup(CONTACT_MAP_MARKERS.map(({ marker }) => marker)).getBounds().pad(0.18), { maxZoom: 13 });
  }
}

function bindContactMap() {
  const mapElement = document.getElementById("contactMap");
  if (!window.L) {
    document.getElementById("contactMapEmpty").textContent = "The pickup map could not load.";
    document.getElementById("contactMapEmpty").hidden = false;
    return;
  }
  CONTACT_MAP = window.L.map(mapElement, { scrollWheelZoom: false }).setView([14.65, 121.0], 10);
  window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(CONTACT_MAP);
  renderContactMapMarkers();

  const locationList = document.getElementById("contactLocations");
  const highlightLocation = locationId => {
    CONTACT_MAP_MARKERS.forEach(({ location, marker }) => {
      const isActive = String(location.id) === locationId;
      marker.setZIndexOffset(isActive ? 1200 : 0);
      marker.getElement()?.classList.toggle("is-highlighted", isActive);
      const option = locationList.querySelector(`[data-location-id="${CSS.escape(String(location.id))}"]`);
      option?.classList.toggle("is-active", isActive);
      if (isActive) marker.openPopup();
      else marker.closePopup();
    });
  };
  locationList.addEventListener("pointerover", event => {
    const option = event.target.closest("[data-location-id]");
    if (option) highlightLocation(option.dataset.locationId);
  });
  locationList.addEventListener("pointerout", event => {
    const option = event.target.closest("[data-location-id]");
    if (!option || (event.relatedTarget instanceof Element && option.contains(event.relatedTarget))) return;
    highlightLocation("");
  });
  locationList.addEventListener("focusin", event => {
    const option = event.target.closest("[data-location-id]");
    if (option) highlightLocation(option.dataset.locationId);
  });
  locationList.addEventListener("focusout", event => {
    const option = event.target.closest("[data-location-id]");
    if (!option || (event.relatedTarget instanceof Element && option.contains(event.relatedTarget))) return;
    highlightLocation("");
  });
  locationList.addEventListener("click", event => {
    const option = event.target.closest("[data-location-id]");
    if (!option) return;
    const entry = CONTACT_MAP_MARKERS.find(({ location }) => String(location.id) === option.dataset.locationId);
    if (!entry) return;
    highlightLocation(option.dataset.locationId);
    CONTACT_MAP.setView(entry.marker.getLatLng(), Math.max(CONTACT_MAP.getZoom(), 14), { animate: true });
  });

  const panel = document.getElementById("contactMapPanel");
  const button = document.getElementById("contactMapFullscreen");
  const header = document.getElementById("siteHeader");
  const updateTop = () => {
    if (!CONTACT_MAP_FULLSCREEN) return;
    panel.style.setProperty("--contact-map-top", `${header.getBoundingClientRect().bottom}px`);
    window.requestAnimationFrame(() => CONTACT_MAP.invalidateSize());
  };
  const setFullscreen = enabled => {
    CONTACT_MAP_FULLSCREEN = enabled;
    if (enabled) updateTop();
    else panel.style.removeProperty("--contact-map-top");
    panel.classList.toggle("is-fullscreen", enabled);
    document.body.classList.toggle("has-contact-map-fullscreen", enabled);
    button.setAttribute("aria-pressed", String(enabled));
    button.setAttribute("aria-label", enabled ? "Exit pickup map fullscreen" : "Expand pickup locations map");
    button.title = enabled ? "Exit fullscreen" : "Expand map";
    button.innerHTML = `<i class="fa-solid ${enabled ? "fa-compress" : "fa-expand"}" aria-hidden="true"></i>`;
    window.requestAnimationFrame(() => CONTACT_MAP.invalidateSize());
  };
  button.addEventListener("click", () => setFullscreen(!CONTACT_MAP_FULLSCREEN));
  window.addEventListener("resize", updateTop);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && CONTACT_MAP_FULLSCREEN) setFullscreen(false);
  });
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
  const openPickups = PICKUP_POINTS.filter(point => point.status !== "closed");
  const candidates = openPickups.length ? openPickups : PICKUP_POINTS;
  return candidates.map(point => ({
    ...point,
    distanceKm: distanceBetweenKilometers(location, point)
  })).sort((first, second) => first.distanceKm - second.distanceKm)[0];
}

function createBookingLocationIcon(color, isPreview = false) {
  const iconSize = isPreview ? 24 : 34;
  return window.L.divIcon({
    className: `booking-location-marker${isPreview ? " booking-location-marker-preview" : ""}`,
    html: `<i class="fa-solid fa-location-dot" style="--marker-color:${color}" aria-hidden="true"></i>`,
    iconSize: [iconSize, iconSize],
    iconAnchor: [iconSize / 2, iconSize]
  });
}

function updateMapDistance(location, prefix = "") {
  const nearest = findNearestPickup(location);
  document.getElementById("bookingMapDistancePrompt").hidden = true;
  document.getElementById("bookingMapDistanceResult").hidden = false;
  document.getElementById("bookingMapDistancePrefix").textContent = prefix;
  document.getElementById("bookingMapDistanceValue").textContent = nearest.distanceKm.toFixed(2);
  document.getElementById("bookingMapDistanceValue").style.color = nearest.color;
  document.getElementById("bookingMapNearestPickup").textContent = nearest.name;
  BOOKING_PICKUP_MARKERS.forEach(({ point, marker }) => {
    const isNearest = point.name === nearest.name;
    marker.setStyle({
      radius: isNearest ? 9 : 7,
      color: point.color,
      fillColor: point.color,
      fillOpacity: isNearest ? 1 : 0.78,
      weight: isNearest ? 3 : 2
    });
  });
  if (BOOKING_TARGET_MARKER) {
    BOOKING_TARGET_MARKER.setIcon(createBookingLocationIcon(nearest.color));
  }
  if (BOOKING_PREVIEW_MARKER) {
    BOOKING_PREVIEW_MARKER.setIcon(createBookingLocationIcon(nearest.color, true));
  }
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
  else BOOKING_TARGET_MARKER = window.L.marker([location.lat, location.lng], {
    icon: createBookingLocationIcon(nearest.color)
  }).addTo(BOOKING_MAP);
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
  BOOKING_TARGET_MARKER = window.L.marker([latitude, longitude], {
    icon: createBookingLocationIcon(nearest.color)
  }).addTo(BOOKING_MAP);
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

  BOOKING_MAP = window.L.map(mapElement, { scrollWheelZoom: false });
  window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(BOOKING_MAP);

  BOOKING_PICKUP_MARKERS = PICKUP_POINTS.map(point => {
    const marker = window.L.circleMarker([point.lat, point.lng], {
      radius: 7,
      color: point.color,
      weight: 2,
      fillColor: point.color,
      fillOpacity: 0.78
    }).addTo(BOOKING_MAP).bindTooltip(point.name);
    return { point, marker };
  });
  BOOKING_MAP.fitBounds(window.L.featureGroup(BOOKING_PICKUP_MARKERS.map(({ marker }) => marker)).getBounds().pad(0.18), { maxZoom: 11 });

  BOOKING_MAP.on("mousemove", event => {
    if (BOOKING_TARGET) return;
    const position = { lat: event.latlng.lat, lng: event.latlng.lng };
    const nearest = updateMapDistance(position);
    if (BOOKING_PREVIEW_MARKER) BOOKING_PREVIEW_MARKER.setLatLng(event.latlng);
    else BOOKING_PREVIEW_MARKER = window.L.marker(event.latlng, {
      icon: createBookingLocationIcon(nearest.color, true),
      interactive: false,
      keyboard: false
    }).addTo(BOOKING_MAP);
  });
  BOOKING_MAP.on("mouseout", () => {
    if (BOOKING_TARGET) updateMapDistance(BOOKING_TARGET, "Selected: ");
    else {
      document.getElementById("bookingMapDistancePrompt").hidden = false;
      document.getElementById("bookingMapDistanceResult").hidden = true;
      BOOKING_PREVIEW_MARKER?.remove();
      BOOKING_PREVIEW_MARKER = null;
      BOOKING_PICKUP_MARKERS.forEach(({ point, marker }) => marker.setStyle({
        radius: 7,
        color: point.color,
        fillColor: point.color,
        fillOpacity: 0.78,
        weight: 2
      }));
    }
  });
  BOOKING_MAP.on("click", event => setBookingTarget({ lat: event.latlng.lat, lng: event.latlng.lng }));

  const fullscreenButton = document.getElementById("bookingMapFullscreen");
  const bookingPanel = document.querySelector(".booking-panel");
  const siteHeader = document.getElementById("siteHeader");
  const updateFullscreenTop = () => {
    if (!BOOKING_MAP_FULLSCREEN) return;
    bookingPanel.style.setProperty("--booking-map-top", `${siteHeader.getBoundingClientRect().bottom}px`);
    window.requestAnimationFrame(() => BOOKING_MAP.invalidateSize());
  };
  let fullscreenAnimationTimer = null;
  const setFullscreen = enabled => {
    BOOKING_MAP_FULLSCREEN = enabled;
    if (enabled) updateFullscreenTop();
    else bookingPanel.style.removeProperty("--booking-map-top");
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
  window.addEventListener("resize", updateFullscreenTop);
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
      document.getElementById("bookingMapDistancePrompt").hidden = false;
      document.getElementById("bookingMapDistanceResult").hidden = true;
      updateBookingPeriodOptions(null);
      document.getElementById("bookingRentalDaysValue").textContent = `${document.getElementById("bookingRentalDays").value} days`;
      document.getElementById("bookingPromoMessage").textContent = `Enjoy ${Number(document.getElementById("bookingRentalDays").value) >= 8 ? 10 : 5}% off by selecting ${document.getElementById("bookingRentalDays").value} days.`;
      BOOKING_MAP.fitBounds(window.L.featureGroup(BOOKING_PICKUP_MARKERS.map(({ marker }) => marker)).getBounds().pad(0.18), { maxZoom: 11 });
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
  const promoPercent = Number(DISCOUNT_RULES.find(rule =>
    rentalDays >= Number(rule.minDays) && rentalDays <= Number(rule.maxDays)
  )?.percent) || 0;
  document.getElementById("bookingPromoMessage").textContent = region !== "luzon" && selectedPeriod === 12
    ? promoPercent
      ? `Enjoy ${promoPercent}% off by selecting ${rentalDays} days on 24-hour rates.`
      : "No long-rental discount applies to this duration."
    : promoPercent
      ? `Enjoy ${promoPercent}% off by selecting ${rentalDays} days.`
      : "No long-rental discount applies to this duration.";
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
  const discountPercent = periodHours === 24 ? promoPercent : 0;
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
  const authCopy = document.getElementById("bookingAuthCopy");
  const signoutDialog = document.getElementById("signoutConfirmation");
  const cancelSignOutButton = document.getElementById("cancelSignOutButton");
  const confirmSignOutButton = document.getElementById("confirmSignOutButton");
  const signoutConfirmationError = document.getElementById("signoutConfirmationError");
  const submitButton = form.querySelector("[type=submit]");
  const draftKey = "cartogo.bookingDraft";
  const signInPendingKey = "cartogo.customerGoogleSignInPending";
  const authToast = document.getElementById("authToast");
  const nameFields = document.getElementById("bookingNameFields");
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
  const getGoogleProfileName = user => {
    const profile = user?.user_metadata || {};
    const fullName = String(profile.full_name || profile.name || "").trim();
    if (fullName) return fullName;
    return [profile.given_name, profile.middle_name, profile.family_name]
      .map(value => String(value || "").trim())
      .filter(Boolean)
      .join(" ");
  };
  const showAuthToast = message => {
    authToast.textContent = message;
    authToast.classList.add("show");
    clearTimeout(authToast.hideTimeout);
    authToast.hideTimeout = setTimeout(() => authToast.classList.remove("show"), 3000);
  };
  const updateVerificationUI = () => {
    const isGoogle = hasVerifiedGoogleAccount(currentUser);
    googleButton.hidden = false;
    nameFields.hidden = false;
    nameFields.querySelectorAll(".booking-profile-field").forEach(field => {
      field.hidden = isGoogle;
    });
    if (isGoogle) {
      googleButton.innerHTML = '<i class="fa-brands fa-google" aria-hidden="true"></i> SIGN OUT';
      googleButton.setAttribute("aria-label", "Sign out of Google");
      authCopy.textContent = "Your Google account is connected to this inquiry.";
      authStatus.textContent = `Signed in as ${getGoogleProfileName(currentUser) || currentUser.email}. Google verified this email.`;
      if (sessionStorage.getItem(signInPendingKey) === "true") {
        sessionStorage.removeItem(signInPendingKey);
        showAuthToast("Signed in successfully.");
      }
    } else {
      googleButton.innerHTML = '<i class="fa-brands fa-google" aria-hidden="true"></i> Continue with Google';
      googleButton.setAttribute("aria-label", "Continue with Google");
      authCopy.textContent = "Sign in with Google to send your inquiry.";
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
    const name = hasVerifiedGoogleAccount(currentUser)
      ? getGoogleProfileName(currentUser)
      : (() => {
        const lastName = document.getElementById("bookingLastName").value.trim();
        const firstName = document.getElementById("bookingFirstName").value.trim();
        const middleName = document.getElementById("bookingMiddleName").value.trim();
        const nameExtension = document.getElementById("bookingSuffix").value.trim();
        const nameParts = [lastName, firstName, middleName].filter(Boolean);
        let submittedName = `${nameParts[0]}, ${nameParts.slice(1).join(" ")}`;
        if (nameExtension) submittedName += `, ${nameExtension}`;
        return submittedName;
      })();
    const carId = document.getElementById("bookingCar").value;
    const car = CARS.find(item => item.id === carId);
    const emailInput = document.getElementById("bookingEmail");
    const enteredEmail = emailInput.value.trim();
    return {
      name,
      email: enteredEmail && emailInput.validity.valid ? enteredEmail : currentUser?.email || "",
      phone: document.getElementById("bookingPhone").value.trim(),
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
    document.getElementById("recapEmail").textContent = inquiry.email || currentUser.email;
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
    pendingInquiry = { ...inquiry, email: inquiry.email || currentUser.email };
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
  cancelSignOutButton.addEventListener("click", () => signoutDialog.close());
  signoutDialog.addEventListener("click", event => {
    if (event.target === signoutDialog) signoutDialog.close();
  });
  signoutDialog.addEventListener("close", () => {
    confirmSignOutButton.disabled = false;
    cancelSignOutButton.disabled = false;
    signoutConfirmationError.hidden = true;
    signoutConfirmationError.textContent = "";
  });
  confirmSignOutButton.addEventListener("click", async () => {
    if (!hasVerifiedGoogleAccount(currentUser)) {
      signoutDialog.close();
      updateVerificationUI();
      return;
    }
    confirmSignOutButton.disabled = true;
    cancelSignOutButton.disabled = true;
    signoutConfirmationError.hidden = true;
    try {
      const { error } = await supa.auth.signOut();
      if (error) throw error;
      sessionStorage.removeItem(draftKey);
      sessionStorage.removeItem(signInPendingKey);
      currentUser = null;
      updateVerificationUI();
      signoutDialog.close();
      googleButton.disabled = false;
      msg.className = "form-msg";
      msg.textContent = "";
      showAuthToast("Sign out successfully.");
      document.getElementById("bookingFirstName").focus({ preventScroll: true });
    } catch (error) {
      signoutDialog.close();
      googleButton.disabled = false;
      showAuthToast(`Could not sign out: ${error.message}`);
    }
  });

  googleButton.addEventListener("click", async () => {
    if (hasVerifiedGoogleAccount(currentUser)) {
      signoutConfirmationError.hidden = true;
      signoutDialog.showModal();
      cancelSignOutButton.focus();
      return;
    }

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
    const isGoogle = hasVerifiedGoogleAccount(currentUser);

    if ((!isGoogle && (!lastName || !firstName)) || (isGoogle && !inquiry.name) || !inquiry.carId || !inquiry.pickupDate || !inquiry.pickupTime || !inquiry.returnDate) {
      msg.className = "form-msg error";
      msg.textContent = isGoogle && !inquiry.name
        ? "Your Google account did not provide a profile name. Add a name to your Google profile and sign in again."
        : "Please fill in your name, car, pickup date, pickup time, and rental duration.";
      return;
    }
    const phoneDigits = inquiry.phone.replace(/\D/g, "");
    if (phoneDigits.length < 7 || phoneDigits.length > 15) {
      msg.className = "form-msg error";
      msg.textContent = "Enter a phone number with 7 to 15 digits, including the country code if applicable.";
      document.getElementById("bookingPhone").focus();
      return;
    }
    const emailInput = document.getElementById("bookingEmail");
    if (!isGoogle && emailInput.value.trim() && !emailInput.validity.valid) {
      msg.className = "form-msg error";
      msg.textContent = "Enter a valid email address or leave the optional email field blank.";
      emailInput.focus();
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
