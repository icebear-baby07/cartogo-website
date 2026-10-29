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
let BOOKING_ORIGIN_MARKER = null;
let BOOKING_VALIDATION_PROMPT_TIMER = null;
let BOOKING_VALIDATION_PROMPT_SWAP_TIMER = null;
let BOOKING_PREVIEW_MARKER = null;
let BOOKING_TARGET_REGION_LOOKUP = null;
let BOOKING_RATE_QUOTE = null;
let BOOKING_RENTAL_MODE = null;
let BOOKING_MAP_FULLSCREEN = false;
let BOOKING_ROUTE_TIMER = null;
let BOOKING_ROUTE_CONTROLLER = null;
let BOOKING_ROUTE_SEQUENCE = 0;
let BOOKING_NEAREST_ROUTE = null;
let BOOKING_ROUTE_LOADING_TIMER = null;
let BOOKING_ROUTE_LOADING_SWAP_TIMER = null;
let BOOKING_LOCATION_SEARCH_CONTROLLER = null;
let BOOKING_DURATION_SELECTED = false;
let BOOKING_GEOCODE_CONTROLLER = null;
let BOOKING_LAST_GEOCODE_AT = 0;
const BOOKING_GEOCODE_CACHE = new Map();
let BOOKING_PREVIEW_LOOKUP_TIMER = null;
let BOOKING_PREVIEW_LOOKUP_SEQUENCE = 0;
let BOOKING_HOVER_VALIDATION_CONTROLLER = null;
let BOOKING_HOVER_VALIDATION_PROMISE = null;
let BOOKING_HOVER_VALIDATION_KEY = null;
const BOOKING_PREVIEW_NAME_CACHE = new Map();
let HOW_SLIDESHOW_INDEX = 0;
let HOW_SLIDESHOW_TIMER = null;
let HOW_SLIDESHOW_HOVERED = false;
let HOW_SLIDESHOW_FOCUSED = false;
const HOW_SLIDESHOW_INTERVAL = 7000;
const HOW_IT_WORKS_PROCEDURE = {
  title: "Return the vehicle",
  description: "Bring the car back at the agreed time and place. Contact our team in advance if you need to request a change."
};

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
  renderHeroShortcuts();
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
function renderHeroShortcuts() {
  const wrap = document.getElementById("heroShortcuts");
  const shortcuts = [
    { value: CARS.length, label: "Cars in our fleet", icon: "fa-car-side", href: "#fleet", action: "fleet" },
    { value: CARS.length, label: "Vehicle options", icon: "fa-list-check", href: "#fleet", action: "fleet" },
    { value: CARS.filter((car) => car.available).length, label: "Pickup areas", icon: "fa-location-dot", href: "#booking", action: "pickup" },
    { value: "Easy", label: "Online inquiry", icon: "fa-arrow-right", href: "#booking", action: "inquiry" }
  ];
  wrap.innerHTML = shortcuts.map(item => `
    <a class="hero-shortcut" href="${item.href}" data-shortcut-action="${item.action}">
      <b>${escapeHtml(String(item.value))}</b>
      <span><i class="fa-solid ${item.icon}" aria-hidden="true"></i> ${escapeHtml(item.label)}</span>
    </a>
  `).join("");
  wrap.querySelectorAll('[data-shortcut-action="pickup"]').forEach(link => {
    link.addEventListener("click", event => {
      event.preventDefault();
      document.getElementById("bookingMap").scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });
  finishLoading(wrap);
  wrap.setAttribute("aria-label", "Fleet and booking shortcuts");
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
  const steps = [...(Array.isArray(LABELS.howItWorks) ? LABELS.howItWorks : [])];
  if (!steps.some(step => step.title?.trim().toLowerCase() === HOW_IT_WORKS_PROCEDURE.title.toLowerCase())) {
    steps.push(HOW_IT_WORKS_PROCEDURE);
  }
  const stage = wrap.querySelector(".how-slideshow-stage");
  stage.removeAttribute("aria-hidden");
  stage.innerHTML = steps.map((step, index) => `
    <article class="marker how-slide" role="group" aria-roledescription="slide" aria-label="Step ${index + 1} of ${steps.length}" aria-hidden="true" inert>
      <div class="num">${String(index + 1).padStart(2, "0")}</div>
      <p class="how-slide-count">Step ${index + 1} of ${steps.length}</p>
      <h3>${escapeHtml(step.title)}</h3>
      <p>${escapeHtml(step.description)}</p>
    </article>
  `).join("");
  wrap.querySelector(".how-slide-indicators").innerHTML = steps.map((step, index) => `
    <button class="how-slide-indicator" type="button" data-how-action="go" data-how-index="${index}" aria-label="Go to step ${index + 1}: ${escapeHtml(step.title)}" aria-pressed="false">
      <span aria-hidden="true"></span>
    </button>
  `).join("");
  wrap.querySelectorAll(".how-slide-control").forEach(button => { button.disabled = steps.length < 2; });
  wrap.addEventListener("click", handleHowSlideshowClick);
  wrap.addEventListener("pointerenter", () => {
    HOW_SLIDESHOW_HOVERED = true;
    updateHowSlideshowTimer();
  });
  wrap.addEventListener("pointerleave", () => {
    HOW_SLIDESHOW_HOVERED = false;
    updateHowSlideshowTimer();
  });
  wrap.addEventListener("focusin", () => {
    HOW_SLIDESHOW_FOCUSED = true;
    updateHowSlideshowTimer();
  });
  wrap.addEventListener("focusout", event => {
    if (!(event.relatedTarget instanceof Element) || !wrap.contains(event.relatedTarget)) {
      HOW_SLIDESHOW_FOCUSED = false;
      updateHowSlideshowTimer();
    }
  });
  document.addEventListener("visibilitychange", updateHowSlideshowTimer);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  reducedMotion.addEventListener?.("change", updateHowSlideshowTimer);
  showHowItWorksSlide(0);
  updateHowSlideshowTimer();
  finishLoading(wrap);
  wrap.setAttribute("aria-label", "Rental procedure slideshow");
}

function showHowItWorksSlide(index, announce = false) {
  const wrap = document.getElementById("markersGrid");
  const slides = [...wrap.querySelectorAll(".how-slide")];
  if (!slides.length) return;
  HOW_SLIDESHOW_INDEX = (index + slides.length) % slides.length;
  slides.forEach((slide, slideIndex) => {
    const isActive = slideIndex === HOW_SLIDESHOW_INDEX;
    slide.classList.toggle("is-active", isActive);
    slide.setAttribute("aria-hidden", String(!isActive));
    slide.inert = !isActive;
  });
  wrap.querySelectorAll(".how-slide-indicator").forEach((indicator, indicatorIndex) => {
    indicator.setAttribute("aria-pressed", String(indicatorIndex === HOW_SLIDESHOW_INDEX));
  });
  if (announce) {
    document.getElementById("howSlideAnnouncement").textContent =
      `Step ${HOW_SLIDESHOW_INDEX + 1} of ${slides.length}: ${slides[HOW_SLIDESHOW_INDEX].querySelector("h3").textContent}`;
  }
}

function handleHowSlideshowClick(event) {
  const control = event.target.closest("[data-how-action]");
  if (!control || control.disabled) return;
  const action = control.dataset.howAction;
  const nextIndex = action === "previous"
    ? HOW_SLIDESHOW_INDEX - 1
    : action === "next"
      ? HOW_SLIDESHOW_INDEX + 1
      : Number(control.dataset.howIndex);
  showHowItWorksSlide(nextIndex, true);
  updateHowSlideshowTimer();
}

function updateHowSlideshowTimer() {
  window.clearTimeout(HOW_SLIDESHOW_TIMER);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (HOW_SLIDESHOW_HOVERED || HOW_SLIDESHOW_FOCUSED || document.hidden || reducedMotion) return;
  HOW_SLIDESHOW_TIMER = window.setTimeout(() => {
    showHowItWorksSlide(HOW_SLIDESHOW_INDEX + 1);
    updateHowSlideshowTimer();
  }, HOW_SLIDESHOW_INTERVAL);
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
    ? publicCars.map((car, index) => `
      <tr style="--rate-row-index:${index}">
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
      <span class="fee-chip-detail" id="feeChipDetail${index}" aria-hidden="true" inert><span>${escapeHtml(item.detail)}</span></span>
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
      detail.setAttribute("aria-hidden", String(!isExpanded));
      detail.inert = !isExpanded;
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

function createPickupMapMarkerElement(color, highlighted = false) {
  const element = document.createElement("span");
  element.className = `pickup-map-marker${highlighted ? " is-highlighted" : ""}`;
  element.style.setProperty("--marker-color", color);
  element.innerHTML = '<i class="fa-solid fa-location-dot" aria-hidden="true"></i>';
  return element;
}

function createBookingMapMarkerElement(color, isPreview = false) {
  const element = createPickupMapMarkerElement(color);
  element.classList.add("booking-location-marker");
  if (isPreview) element.classList.add("booking-location-marker-preview");
  return element;
}

function clearBookingSnapConnection() {
  BOOKING_ORIGIN_MARKER?.remove();
  BOOKING_ORIGIN_MARKER = null;
  BOOKING_MAP?.getSource("booking-snap-connection")?.setData({
    type: "FeatureCollection",
    features: []
  });
  const indicator = document.getElementById("bookingMapSnapStatus");
  if (indicator) {
    indicator.hidden = true;
    document.getElementById("bookingMapSnapStatusText").textContent = "";
  }
}

function showBookingSnapConnection(target) {
  clearBookingSnapConnection();
  if (!target.snappedDistanceMeters || target.snappedDistanceMeters <= 0) return;
  const source = BOOKING_MAP?.getSource("booking-snap-connection");
  if (!source) return;
  source.setData({
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: [
        [target.originalLng, target.originalLat],
        [target.lng, target.lat]
      ]
    },
    properties: {}
  });
  const originElement = createPickupMapMarkerElement("#404040");
  originElement.classList.add("booking-location-marker-origin");
  originElement.title = "Your original point";
  originElement.setAttribute("aria-label", "Your original point before moving to a verified location");
  BOOKING_ORIGIN_MARKER = new window.maplibregl.Marker({
    element: originElement,
    anchor: "bottom"
  }).setLngLat([target.originalLng, target.originalLat]).addTo(BOOKING_MAP);
  document.getElementById("bookingMapSnapStatusText").textContent =
    `The nearest road I can point to the destination is ${target.label} (${(target.snappedDistanceMeters / 1000).toFixed(2)} km away). The dotted line links your original point to the selected pin.`;
  document.getElementById("bookingMapSnapStatus").hidden = false;
}

function createEsriMapStyle() {
  const streetAttribution = "Sources: Esri, HERE, Garmin, USGS, Intermap, INCREMENT P, NRCan, Esri Japan, METI, Esri China (Hong Kong), Esri Korea, Esri (Thailand), NGCC, &copy; OpenStreetMap contributors, and the GIS User Community";
  return {
    version: 8,
    sources: {
      "esri-street": {
        type: "raster",
        tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}"],
        tileSize: 256,
        attribution: streetAttribution
      },
      "esri-imagery": {
        type: "raster",
        tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
        tileSize: 256,
        attribution: "Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community"
      }
    },
    layers: [
      { id: "esri-world-imagery", type: "raster", source: "esri-imagery", layout: { visibility: "none" } },
      { id: "esri-world-street-map", type: "raster", source: "esri-street" }
    ]
  };
}

function bindMapStyleToggle(map, button) {
  let satelliteEnabled = false;
  button.disabled = true;
  button.addEventListener("click", () => {
    satelliteEnabled = !satelliteEnabled;
    map.setLayoutProperty("esri-world-street-map", "visibility", satelliteEnabled ? "none" : "visible");
    map.setLayoutProperty("esri-world-imagery", "visibility", satelliteEnabled ? "visible" : "none");
    button.setAttribute("aria-pressed", String(satelliteEnabled));
    button.title = satelliteEnabled ? "Satellite view enabled; switch to street map" : "Switch to satellite view";
  });
  map.once("style.load", () => {
    button.disabled = false;
  });
}

function addCollapsedMapAttribution(map) {
  map.addControl(new window.maplibregl.AttributionControl({ compact: true }), "bottom-right");
  map.getContainer().querySelector(".maplibregl-ctrl-attrib-button")?.click();
}

function showMapConfigurationMessage(element, message) {
  element.textContent = message;
  element.hidden = false;
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
    const marker = new window.maplibregl.Marker({
      element: createPickupMapMarkerElement(color),
      anchor: "bottom"
    }).setLngLat([longitude, latitude]).addTo(CONTACT_MAP);
    const hours = location.opening_hours && location.closing_hours
      ? `${String(location.opening_hours).slice(0, 5)} - ${String(location.closing_hours).slice(0, 5)}`
      : "Hours not listed";
    const content = `<strong>${escapeHtml(location.display_name)}</strong><br>${escapeHtml(location.description || "")}<br>${escapeHtml(hours)} · ${location.status === "closed" ? "Closed" : "Open"}`;
    const popup = new window.maplibregl.Popup({ offset: 28, closeButton: true }).setHTML(content);
    marker.setPopup(popup);
    CONTACT_MAP_MARKERS.push({ location, marker });
  });
  if (CONTACT_MAP_MARKERS.length) {
    const bounds = new window.maplibregl.LngLatBounds();
    CONTACT_MAP_MARKERS.forEach(({ marker }) => bounds.extend(marker.getLngLat()));
    CONTACT_MAP.fitBounds(bounds, { padding: 40, maxZoom: 13 });
  }
}

function bindContactMap() {
  const mapElement = document.getElementById("contactMap");
  const locationList = document.getElementById("contactLocations");
  const highlightLocation = locationId => {
    const selected = CONTACT_MAP_MARKERS.find(({ location }) => String(location.id) === locationId);
    CONTACT_MAP_MARKERS.forEach(({ location, marker }) => {
      const isActive = String(location.id) === locationId;
      marker.getElement().classList.toggle("is-highlighted", isActive);
      const option = locationList.querySelector(`[data-location-id="${CSS.escape(String(location.id))}"]`);
      option?.classList.toggle("is-active", isActive);
    });
    CONTACT_MAP_MARKERS.forEach(({ marker }) => marker.getPopup()?.remove());
    const popup = selected?.marker.getPopup();
    if (popup && !popup.isOpen()) popup.addTo(CONTACT_MAP);
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
    CONTACT_MAP.flyTo({
      center: entry.marker.getLngLat(),
      zoom: Math.max(CONTACT_MAP.getZoom(), 14)
    });
  });

  const panel = document.getElementById("contactMapPanel");
  const button = document.getElementById("contactMapFullscreen");
  const header = document.getElementById("siteHeader");
  const updateTop = () => {
    if (!CONTACT_MAP_FULLSCREEN) return;
    panel.style.setProperty("--contact-map-top", `${header.getBoundingClientRect().bottom}px`);
    window.requestAnimationFrame(() => {
      if (!CONTACT_MAP) return;
      CONTACT_MAP.resize();
    });
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
    window.requestAnimationFrame(() => {
      if (!CONTACT_MAP) return;
      CONTACT_MAP.resize();
    });
  };
  button.addEventListener("click", () => setFullscreen(!CONTACT_MAP_FULLSCREEN));
  window.addEventListener("resize", updateTop);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && CONTACT_MAP_FULLSCREEN) setFullscreen(false);
  });

  if (!window.maplibregl?.Map) {
    showMapConfigurationMessage(document.getElementById("contactMapEmpty"), "The pickup map could not load. Check the MapLibre connection and refresh.");
    return;
  }
  try {
    CONTACT_MAP = new window.maplibregl.Map({
      container: mapElement,
      style: createEsriMapStyle(),
      center: [121.0, 14.65],
      zoom: 10,
      cooperativeGestures: true,
      attributionControl: false
    });
    bindMapStyleToggle(CONTACT_MAP, document.getElementById("contactMapStyleToggle"));
    CONTACT_MAP.addControl(new window.maplibregl.NavigationControl({ showCompass: false }), "top-right");
    CONTACT_MAP.once("load", () => {
      addCollapsedMapAttribution(CONTACT_MAP);
      document.getElementById("contactMapEmpty").hidden = SITE_ASSETS.some(asset => asset.asset_type === "location");
      renderContactMapMarkers();
    });
    CONTACT_MAP.on("error", event => {
      console.error("The pickup map encountered a tile or style error.", event.error);
      showMapConfigurationMessage(document.getElementById("contactMapEmpty"), "Some pickup map content could not be loaded.");
    });
  } catch (error) {
    showMapConfigurationMessage(document.getElementById("contactMapEmpty"), error.message || "The pickup map could not be initialized.");
    console.error("The pickup map could not be initialized.", error);
  }
}

/* ---------- Booking form select ---------- */
function populateCarSelect(preferredId = null) {
  const select = document.getElementById("bookingCar");
  const selectedId = preferredId || select.value;
  const capacityValue = document.getElementById("bookingCapacity").value.trim();
  const requestedCapacity = Number(capacityValue);
  const matchingCars = !capacityValue
    ? CARS
    : Number.isInteger(requestedCapacity) && requestedCapacity > 0
      ? CARS.filter(car => Number(car.seats) >= requestedCapacity)
      : [];
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

async function findNearestPickupByRoad(location, signal) {
  const openPickups = PICKUP_POINTS.filter(point => point.status !== "closed");
  const candidates = openPickups.length ? openPickups : PICKUP_POINTS;
  if (!candidates.length) throw new Error("No pickup locations are available for routing.");
  const coordinates = [location, ...candidates]
    .map(point => `${point.lng},${point.lat}`)
    .join(";");
  const response = await fetch(
    `https://router.project-osrm.org/table/v1/driving/${coordinates}?sources=0&annotations=distance`,
    { signal, cache: "no-store" }
  );
  if (!response.ok) throw new Error(`OSRM returned HTTP ${response.status}.`);
  const result = await response.json();
  if (result.code !== "Ok" || !Array.isArray(result.distances?.[0])) {
    throw new Error("OSRM could not calculate road distances for this location.");
  }
  const reachable = candidates.map((point, index) => {
    const meters = result.distances[0][index + 1];
    return Number.isFinite(meters) && meters >= 0
      ? { ...point, distanceKm: meters / 1000, distanceType: "driving" }
      : null;
  }).filter(Boolean);
  if (!reachable.length) throw new Error("OSRM found no reachable pickup locations.");
  return reachable.sort((first, second) => first.distanceKm - second.distanceKm)[0];
}

async function findDrivingRoute(location, pickup, signal) {
  const coordinates = `${location.lng},${location.lat};${pickup.lng},${pickup.lat}`;
  const response = await fetch(
    `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`,
    { signal, cache: "no-store" }
  );
  if (!response.ok) throw new Error(`OSRM returned HTTP ${response.status} for the driving route.`);
  const result = await response.json();
  const route = result.code === "Ok" && Array.isArray(result.routes) ? result.routes[0] : null;
  const coordinatesList = route?.geometry?.coordinates;
  if (
    !Array.isArray(coordinatesList)
    || coordinatesList.length < 2
    || coordinatesList.some(coordinate => !Array.isArray(coordinate)
      || coordinate.length < 2
      || !Number.isFinite(coordinate[0])
      || !Number.isFinite(coordinate[1]))
  ) {
    throw new Error("OSRM returned no valid driving route to the nearest pickup area.");
  }
  return {
    mode: "driving",
    pickupName: pickup.name,
    distanceMeters: route.distance,
    durationSeconds: route.duration,
    geometry: { type: "LineString", coordinates: coordinatesList }
  };
}

function clearBookingNearestRoute() {
  BOOKING_NEAREST_ROUTE = null;
  const routeSource = BOOKING_MAP?.getSource("booking-nearest-route");
  routeSource?.setData({ type: "FeatureCollection", features: [] });
}

function displayBookingNearestRoute(route, pickup) {
  BOOKING_NEAREST_ROUTE = route;
  const routeSource = BOOKING_MAP?.getSource("booking-nearest-route");
  if (!routeSource) return;
  routeSource.setData({
    type: "Feature",
    geometry: route.geometry,
    properties: {
      color: pickup.color,
      pickupName: pickup.name,
      mode: route.mode
    }
  });
}

const BOOKING_ROUTE_LOADING_PROMPTS = [
  "I'm processing your route request...",
  "I'm checking your location and nearby roads...",
  "I'm finding the best way to a pickup area...",
  "I'm calculating the road distance to your nearest pickup...",
  "I'm looking for a suitable driving route...",
  "I'm comparing roads to your nearest pickup...",
  "I'm preparing your driving route...",
  "I'm mapping the route from your location...",
  "I'm getting your distance and route details...",
  "I'm almost done — just finishing your route preview..."
];

function shuffleBookingPrompts(prompts) {
  const shuffled = [...prompts];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function setBookingRouteLoading() {
  if (!document.getElementById("bookingRouteLoading").hidden) return;
  const status = document.getElementById("bookingRouteLoadingText");
  const prompt = document.createElement("span");
  prompt.className = "booking-target-waiting-prompt";
  const messages = shuffleBookingPrompts(BOOKING_ROUTE_LOADING_PROMPTS);
  let messageIndex = 0;
  prompt.textContent = messages[messageIndex];
  status.replaceChildren(prompt);
  document.getElementById("bookingRouteLoading").hidden = false;
  BOOKING_ROUTE_LOADING_TIMER = window.setInterval(() => {
    prompt.classList.add("is-transitioning");
    BOOKING_ROUTE_LOADING_SWAP_TIMER = window.setTimeout(() => {
      if (!prompt.isConnected) {
        clearBookingRouteLoading();
        return;
      }
      messageIndex = (messageIndex + 1) % messages.length;
      prompt.textContent = messages[messageIndex];
      prompt.classList.remove("is-transitioning");
    }, 220);
  }, 2800);
}

function clearBookingRouteLoading() {
  window.clearInterval(BOOKING_ROUTE_LOADING_TIMER);
  window.clearTimeout(BOOKING_ROUTE_LOADING_SWAP_TIMER);
  BOOKING_ROUTE_LOADING_TIMER = null;
  BOOKING_ROUTE_LOADING_SWAP_TIMER = null;
  document.getElementById("bookingRouteLoading").hidden = true;
  document.getElementById("bookingRouteLoadingText").replaceChildren();
}

function updateMapDistance(location, prefix = "", routedNearest = null, distanceType = "straight-line") {
  const nearest = routedNearest || findNearestPickup(location);
  if (!nearest) {
    document.getElementById("bookingMapDistancePrompt").textContent = "Pickup areas are unavailable, so distance cannot be calculated.";
    document.getElementById("bookingMapDistancePrompt").hidden = false;
    document.getElementById("bookingMapDistanceResult").hidden = true;
    return null;
  }
  document.getElementById("bookingMapDistancePrompt").hidden = true;
  document.getElementById("bookingMapDistanceResult").hidden = false;
  document.getElementById("bookingMapDistancePrefix").textContent = prefix;
  document.getElementById("bookingMapDistanceValue").textContent = nearest.distanceKm.toFixed(2);
  document.getElementById("bookingMapDistanceKind").textContent = distanceType === "driving"
    ? "driving distance"
    : distanceType === "fallback"
      ? "approximate straight-line distance (route unavailable)"
      : distanceType === "pending"
        ? "approximate straight-line distance (calculating route)"
        : "straight-line distance";
  document.getElementById("bookingMapDistanceValue").style.color = nearest.color;
  document.getElementById("bookingMapNearestPickup").textContent = nearest.name;
  BOOKING_PICKUP_MARKERS.forEach(({ point, marker }) => {
    const isNearest = point.name === nearest.name;
    marker.getElement().classList.toggle("is-nearest", isNearest);
  });
  if (BOOKING_TARGET_MARKER) {
    BOOKING_TARGET_MARKER.getElement().style.setProperty("--marker-color", nearest.color);
  }
  if (BOOKING_PREVIEW_MARKER) {
    BOOKING_PREVIEW_MARKER.getElement().style.setProperty("--marker-color", nearest.color);
  }
  return nearest;
}

function cancelBookingRouteLookup() {
  window.clearTimeout(BOOKING_ROUTE_TIMER);
  BOOKING_ROUTE_TIMER = null;
  BOOKING_ROUTE_SEQUENCE += 1;
  BOOKING_ROUTE_CONTROLLER?.abort();
  BOOKING_ROUTE_CONTROLLER = null;
  clearBookingRouteLoading();
}

function scheduleBookingRoutePreview(location) {
  cancelBookingRouteLookup();
  clearBookingNearestRoute();
  if (!PICKUP_POINTS.length) return;
  const sequence = BOOKING_ROUTE_SEQUENCE;
  let roadLocation = location;
  BOOKING_ROUTE_TIMER = window.setTimeout(async () => {
    BOOKING_ROUTE_TIMER = null;
    BOOKING_ROUTE_CONTROLLER = new AbortController();
    try {
      setBookingRouteLoading();
      const validation = await getBookingHoverValidation(location);
      if (sequence !== BOOKING_ROUTE_SEQUENCE || BOOKING_TARGET || !validation.valid) return;
      if (!isBookingRegionSupported(classifyTargetRegion(validation.address))) {
        showBookingOutOfBoundsPreview();
        return;
      }
      roadLocation = validation.snapped
        ? { lat: validation.latitude, lng: validation.longitude }
        : location;
      setBookingRouteLoading();
      const nearest = await findNearestPickupByRoad(roadLocation, BOOKING_ROUTE_CONTROLLER.signal);
      if (sequence !== BOOKING_ROUTE_SEQUENCE || BOOKING_TARGET) return;
      updateMapDistance(roadLocation, "", nearest, "driving");
      try {
        setBookingRouteLoading();
        const route = await findDrivingRoute(roadLocation, nearest, BOOKING_ROUTE_CONTROLLER.signal);
        if (sequence !== BOOKING_ROUTE_SEQUENCE || BOOKING_TARGET) return;
        displayBookingNearestRoute(route, nearest);
      } catch (error) {
        if (error.name === "AbortError" || sequence !== BOOKING_ROUTE_SEQUENCE) return;
        console.warn("OSRM could not provide the hovered driving route.", error);
      }
    } catch (error) {
      if (error.name === "AbortError" || sequence !== BOOKING_ROUTE_SEQUENCE) return;
      console.warn("OSRM road distance is unavailable for the map preview; using straight-line distance.", error);
      updateMapDistance(roadLocation, "", null, "fallback");
    } finally {
      if (sequence === BOOKING_ROUTE_SEQUENCE) {
        BOOKING_ROUTE_CONTROLLER = null;
        clearBookingRouteLoading();
      }
    }
  }, 650);
}

async function updateSelectedTargetRoadDistance(target) {
  cancelBookingRouteLookup();
  clearBookingNearestRoute();
  const sequence = BOOKING_ROUTE_SEQUENCE;
  BOOKING_ROUTE_CONTROLLER = new AbortController();
  try {
    setBookingRouteLoading();
    const nearest = await findNearestPickupByRoad(target, BOOKING_ROUTE_CONTROLLER.signal);
    if (BOOKING_TARGET !== target || sequence !== BOOKING_ROUTE_SEQUENCE) return;
    target.nearestPickupName = nearest.name;
    target.nearestPickupDistanceKm = nearest.distanceKm;
    document.getElementById("bookingNearestPickupName").value = nearest.name;
    document.getElementById("bookingNearestPickupDistance").value = nearest.distanceKm.toFixed(3);
    updateMapDistance(target, "Selected: ", nearest, "driving");
    try {
      setBookingRouteLoading();
      const route = await findDrivingRoute(target, nearest, BOOKING_ROUTE_CONTROLLER.signal);
      if (BOOKING_TARGET !== target || sequence !== BOOKING_ROUTE_SEQUENCE) return;
      displayBookingNearestRoute(route, nearest);
    } catch (error) {
      if (error.name === "AbortError" || BOOKING_TARGET !== target || sequence !== BOOKING_ROUTE_SEQUENCE) return;
      console.warn("OSRM could not provide the selected destination's driving route.", error);
    }
  } catch (error) {
    if (error.name === "AbortError" || BOOKING_TARGET !== target || sequence !== BOOKING_ROUTE_SEQUENCE) return;
    console.warn("OSRM road distance is unavailable for the selected target; using straight-line distance.", error);
    updateMapDistance(target, "Selected: ", null, "fallback");
  } finally {
    if (sequence === BOOKING_ROUTE_SEQUENCE) {
      BOOKING_ROUTE_CONTROLLER = null;
      clearBookingRouteLoading();
    }
  }
}

function classifyTargetRegion(address) {
  const normalized = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const addressParts = Object.values(address || {}).filter(value => typeof value === "string").map(normalized);
  const matches = candidates => addressParts.some(part => candidates.some(candidate => part === candidate || part.includes(candidate)));
  const island = normalized(address?.island);
  if (island && !["luzon", "luzon island"].includes(island)) return "out_of_bounds";
  const outOfBoundsRegionsAndIslands = [
    "visayas", "western visayas", "central visayas", "eastern visayas", "negros island region",
    "mindanao", "northern mindanao", "davao region", "soccsksargen", "zamboanga peninsula",
    "caraga", "bangsamoro", "barmm", "mimaropa", "palawan", "batanes", "marinduque",
    "occidental mindoro", "oriental mindoro", "mindoro", "romblon", "catanduanes", "masbate",
    "aklan", "antique", "bacolod", "basilan", "biliran", "bohol", "bukidnon", "cagayan de oro",
    "camiguin", "capiz", "cebu", "davao de oro", "compostela valley", "davao del norte",
    "davao del sur", "davao occidental", "davao oriental", "dinagat islands", "eastern samar",
    "guimaras", "iloilo", "lanao del norte", "lanao del sur", "leyte", "maguindanao",
    "misamis occidental", "misamis oriental", "negros occidental", "negros oriental",
    "northern samar", "samar", "siquijor", "south cotabato", "southern leyte", "sulu",
    "surigao del norte", "surigao del sur", "tawi tawi", "zamboanga del norte",
    "zamboanga del sur", "zamboanga sibugay"
  ];
  if (matches(outOfBoundsRegionsAndIslands)) return "out_of_bounds";

  const metroManilaNames = [
    "national capital region", "metro manila", "ncr", "caloocan", "las pinas", "makati", "malabon",
    "mandaluyong", "manila", "marikina", "muntinlupa", "navotas", "paranaque", "pasay", "pasig",
    "quezon city", "san juan", "taguig", "valenzuela", "pateros"
  ];
  if (matches(metroManilaNames)) return "in";

  const neighboringProvinces = ["bulacan", "rizal", "cavite", "laguna"];
  if (matches(neighboringProvinces)) return "out";

  const luzonRegionsAndProvinces = [
    "ilocos region", "cagayan valley", "central luzon", "calabarzon", "bicol region",
    "cordillera administrative region", "luzon", "abra", "albay", "apayao", "aurora", "bataan",
    "batangas", "benguet", "cagayan", "camarines norte", "camarines sur", "ifugao",
    "ilocos norte", "ilocos sur", "isabela", "kalinga", "la union", "mountain province", "nueva ecija",
    "nueva vizcaya", "pampanga", "pangasinan", "quezon", "quirino", "sorsogon", "tarlac", "zambales"
  ];
  return matches(luzonRegionsAndProvinces) ? "luzon" : null;
}

function regionDisplayName(region) {
  return ({ in: "Metro Manila", out: "Nearby areas", luzon: "Luzon" })[region] || "Unclassified destination";
}

const BOOKING_OUT_OF_BOUNDS_MESSAGES = [
  "I can't serve this location yet. Please choose a destination in Luzon.",
  "I can only help with trips within our Luzon service area. Please select another place.",
  "I can't arrange a road trip to this destination. Please choose a different location in Luzon.",
  "I can't support this area yet. Try a road-accessible place in Luzon.",
  "I can't provide service for this destination. Please select another location.",
  "I can only help with supported destinations in Luzon. Please choose a different point.",
  "I can't serve places that require crossing open water. Please select a location in Luzon.",
  "I don't have service in this area yet. Please choose another destination in Luzon.",
  "I can't connect this destination to our supported road network. Please try another place.",
  "I can't accept this location right now. Please choose a road-accessible place in Luzon."
];

function getBookingOutOfBoundsMessage() {
  return shuffleBookingPrompts(BOOKING_OUT_OF_BOUNDS_MESSAGES)[0];
}

function isBookingRegionSupported(region) {
  return ["in", "out", "luzon"].includes(region);
}

function showBookingOutOfBoundsPreview() {
  document.getElementById("bookingMapDistancePrompt").textContent =
    "I can only preview road distances within our supported Luzon service area.";
  document.getElementById("bookingMapDistancePrompt").hidden = false;
  document.getElementById("bookingMapDistanceResult").hidden = true;
}

function resetBookingMapDistancePrompt() {
  document.getElementById("bookingMapDistancePrompt").textContent =
    "Move the cursor over the map to preview road distance from the nearest pickup point.";
}

function setBookingLocationPreview(label, prefix = "Hovered location: ") {
  document.getElementById("bookingMapPreviewPrefix").textContent = prefix;
  document.getElementById("bookingMapPreviewName").textContent = label;
  document.getElementById("bookingMapPreview").hidden = !label;
}

const BOOKING_VALIDATION_PROMPTS = [
  "I'm checking your location. Please wait...",
  "I'm looking for nearby roads and neighborhoods...",
  "I'm verifying the place you selected...",
  "I'm finding the closest suitable place...",
  "I'm checking that this area works for your booking...",
  "I'm making sure this place is on the map...",
  "I'm checking that you can reach this location...",
  "I'm looking over the area around your selected point...",
  "I'm confirming the details of your location...",
  "I'm almost done — just confirming your location..."
];

function stopBookingValidationPrompts() {
  window.clearInterval(BOOKING_VALIDATION_PROMPT_TIMER);
  window.clearTimeout(BOOKING_VALIDATION_PROMPT_SWAP_TIMER);
  BOOKING_VALIDATION_PROMPT_TIMER = null;
  BOOKING_VALIDATION_PROMPT_SWAP_TIMER = null;
}

function setBookingTargetStatus(message) {
  stopBookingValidationPrompts();
  document.getElementById("bookingTargetStatus").textContent = message;
}

function startBookingValidationPrompts() {
  stopBookingValidationPrompts();
  const status = document.getElementById("bookingTargetStatus");
  const prompt = document.createElement("span");
  prompt.className = "booking-target-waiting-prompt";
  const messages = shuffleBookingPrompts(BOOKING_VALIDATION_PROMPTS);
  let messageIndex = 0;
  prompt.textContent = messages[messageIndex];
  status.replaceChildren(prompt);
  BOOKING_VALIDATION_PROMPT_TIMER = window.setInterval(() => {
    prompt.classList.add("is-transitioning");
    BOOKING_VALIDATION_PROMPT_SWAP_TIMER = window.setTimeout(() => {
      if (!prompt.isConnected) {
        stopBookingValidationPrompts();
        return;
      }
      messageIndex = (messageIndex + 1) % messages.length;
      prompt.textContent = messages[messageIndex];
      prompt.classList.remove("is-transitioning");
    }, 220);
  }, 2800);
}

function cancelBookingLocationPreview() {
  window.clearTimeout(BOOKING_PREVIEW_LOOKUP_TIMER);
  BOOKING_PREVIEW_LOOKUP_TIMER = null;
  BOOKING_PREVIEW_LOOKUP_SEQUENCE += 1;
  BOOKING_HOVER_VALIDATION_CONTROLLER?.abort();
  BOOKING_HOVER_VALIDATION_CONTROLLER = null;
  BOOKING_HOVER_VALIDATION_PROMISE = null;
  BOOKING_HOVER_VALIDATION_KEY = null;
}

function getBookingHoverValidation(location) {
  const cacheKey = `${location.lat.toFixed(6)},${location.lng.toFixed(6)}`;
  const cached = BOOKING_PREVIEW_NAME_CACHE.get(cacheKey);
  if (cached) return Promise.resolve(cached);
  if (BOOKING_HOVER_VALIDATION_PROMISE && BOOKING_HOVER_VALIDATION_KEY === cacheKey) {
    return BOOKING_HOVER_VALIDATION_PROMISE;
  }
  BOOKING_HOVER_VALIDATION_CONTROLLER?.abort();
  BOOKING_HOVER_VALIDATION_CONTROLLER = new AbortController();
  BOOKING_HOVER_VALIDATION_KEY = cacheKey;
  const controller = BOOKING_HOVER_VALIDATION_CONTROLLER;
  const request = fetch("/api/target-location/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ latitude: location.lat, longitude: location.lng, snapInvalid: true }),
    signal: controller.signal
  }).then(async response => {
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Location lookup is temporarily unavailable.");
    BOOKING_PREVIEW_NAME_CACHE.set(cacheKey, data);
    if (BOOKING_PREVIEW_NAME_CACHE.size > 200) {
      BOOKING_PREVIEW_NAME_CACHE.delete(BOOKING_PREVIEW_NAME_CACHE.keys().next().value);
    }
    return data;
  }).finally(() => {
    if (BOOKING_HOVER_VALIDATION_PROMISE === request) {
      BOOKING_HOVER_VALIDATION_PROMISE = null;
      BOOKING_HOVER_VALIDATION_KEY = null;
      BOOKING_HOVER_VALIDATION_CONTROLLER = null;
    }
  });
  BOOKING_HOVER_VALIDATION_PROMISE = request;
  return request;
}

function scheduleBookingLocationPreview(location) {
  window.clearTimeout(BOOKING_PREVIEW_LOOKUP_TIMER);
  const sequence = ++BOOKING_PREVIEW_LOOKUP_SEQUENCE;
  BOOKING_PREVIEW_LOOKUP_TIMER = window.setTimeout(async () => {
    let result;
    try {
      result = await getBookingHoverValidation(location);
    } catch (error) {
      if (error.name === "AbortError" || sequence !== BOOKING_PREVIEW_LOOKUP_SEQUENCE) return;
      setBookingLocationPreview(error.message || "Could not look up this location.");
      return;
    }
    if (sequence !== BOOKING_PREVIEW_LOOKUP_SEQUENCE || BOOKING_TARGET) return;
    if (result.valid && result.snapped) {
      setBookingLocationPreview(
        `${result.label || "Verified road"} (${(result.snapDistanceMeters / 1000).toFixed(2)} km away)`,
        "The nearest road I can point to the destination is "
      );
      BOOKING_PREVIEW_MARKER?.setLngLat([result.longitude, result.latitude]);
    } else {
      setBookingLocationPreview(result.valid
        ? result.label || "No exact mapped place name is available here."
        : result.reason || result.label || "This point is not a verified residential location.");
    }
  }, 650);
}

function setBookingTarget(location) {
  cancelBookingLocationPreview();
  cancelBookingRouteLookup();
  clearBookingNearestRoute();
  clearBookingSnapConnection();
  const nearest = findNearestPickup(location);
  if (!nearest) {
    setBookingTargetStatus("Pickup areas are unavailable, so a target cannot be selected.");
    updateMapDistance(location);
    return;
  }
  BOOKING_TARGET = {
    lat: location.lat,
    lng: location.lng,
    originalLat: location.lat,
    originalLng: location.lng,
    snappedDistanceMeters: 0,
    label: `${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}`,
    rateRegion: null,
    verified: false,
    nearestPickupName: nearest.name,
    nearestPickupDistanceKm: nearest.distanceKm
  };
  BOOKING_TARGET_MARKER?.remove();
  BOOKING_TARGET_MARKER = null;
  document.getElementById("bookingTargetLat").value = location.lat.toFixed(6);
  document.getElementById("bookingTargetLng").value = location.lng.toFixed(6);
  document.getElementById("bookingTargetLabel").value = BOOKING_TARGET.label;
  document.getElementById("bookingTargetRegion").value = "";
  document.getElementById("bookingNearestPickupName").value = nearest.name;
  document.getElementById("bookingNearestPickupDistance").value = nearest.distanceKm.toFixed(3);
  startBookingValidationPrompts();
  setBookingLocationPreview("");
  updateMapDistance(location, "Checking: ", null, "pending");
  BOOKING_PREVIEW_MARKER?.remove();
  BOOKING_PREVIEW_MARKER = null;
  renderBookingEstimate();
  BOOKING_TARGET_REGION_LOOKUP = resolveBookingTargetRegion(BOOKING_TARGET);
}

async function resolveBookingTargetRegion(target) {
  const cacheKey = `${target.lat.toFixed(6)},${target.lng.toFixed(6)}`;
  let result = BOOKING_GEOCODE_CACHE.get(cacheKey);
  if (!result) {
    BOOKING_GEOCODE_CONTROLLER?.abort();
    BOOKING_GEOCODE_CONTROLLER = new AbortController();
    const waitMs = Math.max(0, 1100 - (Date.now() - BOOKING_LAST_GEOCODE_AT));
    if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
    if (BOOKING_TARGET !== target) return;
    BOOKING_LAST_GEOCODE_AT = Date.now();
    try {
      const response = await fetch("/api/target-location/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latitude: target.lat, longitude: target.lng, snapInvalid: true }),
        signal: BOOKING_GEOCODE_CONTROLLER.signal
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Location verification failed. Please choose another point.");
      result = {
        ...data,
        rateRegion: classifyTargetRegion(data.address)
      };
      BOOKING_GEOCODE_CACHE.set(cacheKey, result);
    } catch (error) {
      if (error.name === "AbortError" || BOOKING_TARGET !== target) return;
      clearBookingTarget(error.message || "Location verification failed. Click a different map location and try again.");
      return;
    }
  }

  if (BOOKING_TARGET !== target) return;
  if (!result.valid) {
    clearBookingTarget(result.reason || "This location could not be verified as a residential destination. Choose another map location.");
    return;
  }
  if (!isBookingRegionSupported(result.rateRegion)) {
    clearBookingTarget(getBookingOutOfBoundsMessage());
    return;
  }
  if (result.snapped) {
    if (
      !Number.isFinite(result.latitude)
      || !Number.isFinite(result.longitude)
      || !Number.isFinite(result.snapDistanceMeters)
      || result.snapDistanceMeters < 0
    ) {
      clearBookingTarget("The nearest road could not be verified. Choose another map point.");
      return;
    }
    target.lat = result.latitude;
    target.lng = result.longitude;
    target.snappedDistanceMeters = result.snapDistanceMeters;
    document.getElementById("bookingTargetLat").value = target.lat.toFixed(6);
    document.getElementById("bookingTargetLng").value = target.lng.toFixed(6);
  }
  target.label = result.label || `${target.lat.toFixed(6)}, ${target.lng.toFixed(6)}`;
  target.rateRegion = result.rateRegion;
  target.verified = true;
  document.getElementById("bookingTargetLabel").value = target.label;
  document.getElementById("bookingTargetRegion").value = target.rateRegion || "";
  document.getElementById("bookingNearestPickupName").value = target.nearestPickupName;
  document.getElementById("bookingNearestPickupDistance").value = target.nearestPickupDistanceKm.toFixed(3);
  BOOKING_TARGET_MARKER = new window.maplibregl.Marker({
    element: createBookingMapMarkerElement(findNearestPickup(target).color),
    anchor: "bottom"
  }).setLngLat([target.lng, target.lat]).addTo(BOOKING_MAP);
  showBookingSnapConnection(target);
  stopBookingValidationPrompts();
  if (target.rateRegion) {
    setBookingTargetStatus(`Selected: ${target.label} · ${regionDisplayName(target.rateRegion)} rates`);
  } else {
    setBookingTargetStatus(`Selected: ${target.label} · This location isn't in the supported Luzon pricing area.`);
  }
  updateBookingPeriodOptions(target.rateRegion);
  document.getElementById("bookingPickup").dispatchEvent(new Event("change"));
  renderBookingEstimate();
  updateSelectedTargetRoadDistance(target);
}

function clearBookingTarget(message) {
  BOOKING_TARGET = null;
  BOOKING_TARGET_REGION_LOOKUP = null;
  BOOKING_TARGET_MARKER?.remove();
  BOOKING_TARGET_MARKER = null;
  cancelBookingRouteLookup();
  clearBookingNearestRoute();
  clearBookingSnapConnection();
  ["bookingTargetLat", "bookingTargetLng", "bookingTargetLabel", "bookingTargetRegion", "bookingNearestPickupName", "bookingNearestPickupDistance"].forEach(id => {
    document.getElementById(id).value = "";
  });
  setBookingTargetStatus(message);
  setBookingLocationPreview("");
  resetBookingMapDistancePrompt();
  document.getElementById("bookingMapDistancePrompt").hidden = false;
  document.getElementById("bookingMapDistanceResult").hidden = true;
  renderBookingEstimate();
}

function updateBookingPeriodOptions(region) {
  const periodField = document.getElementById("bookingPeriodField");
  const periodOptions = document.querySelectorAll('input[name="bookingPeriod"]');
  const modeOptions = document.querySelectorAll('input[name="bookingMode"]');
  const note = document.getElementById("bookingPeriodNote");
  const isLuzon = region === "luzon";
  periodField.hidden = false;
  periodField.classList.toggle("luzon-rate", isLuzon);
  periodOptions.forEach(option => {
    option.required = false;
    option.disabled = isLuzon;
    if (isLuzon) option.checked = false;
  });
  if (isLuzon) {
    document.getElementById("bookingModeCustom").checked = true;
    document.getElementById("bookingModeHourly").checked = false;
    document.getElementById("bookingModeHourly").disabled = true;
    BOOKING_RENTAL_MODE = "custom_days";
    note.textContent = "Luzon rates use 24-hour blocks. Select a custom day arrangement.";
    note.hidden = false;
  } else {
    document.getElementById("bookingModeHourly").disabled = false;
    note.hidden = true;
    note.textContent = "";
  }
  if (!isLuzon && !Array.from(modeOptions).some(option => option.checked)) {
    BOOKING_RENTAL_MODE = null;
  }
  periodField.classList.toggle("hourly-selected", BOOKING_RENTAL_MODE === "hourly");
  periodField.classList.toggle("custom-selected", BOOKING_RENTAL_MODE === "custom_days");
}

function restoreBookingTargetFromDraft() {
  if (!BOOKING_MAP) return;
  const latitude = Number(document.getElementById("bookingTargetLat").value);
  const longitude = Number(document.getElementById("bookingTargetLng").value);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !document.getElementById("bookingTargetLabel").value) return;
  const nearest = findNearestPickup({ lat: latitude, lng: longitude });
  BOOKING_TARGET = {
    lat: latitude,
    lng: longitude,
    label: document.getElementById("bookingTargetLabel").value,
    rateRegion: document.getElementById("bookingTargetRegion").value || null,
    verified: false,
    nearestPickupName: document.getElementById("bookingNearestPickupName").value || nearest.name,
    nearestPickupDistanceKm: Number(document.getElementById("bookingNearestPickupDistance").value) || nearest.distanceKm
  };
  BOOKING_MAP.flyTo({ center: [longitude, latitude], zoom: Math.max(BOOKING_MAP.getZoom(), 13) });
  startBookingValidationPrompts();
  setBookingLocationPreview("");
  updateMapDistance(BOOKING_TARGET, "Checking: ");
  BOOKING_RENTAL_MODE = document.querySelector('input[name="bookingMode"]:checked')?.value || BOOKING_RENTAL_MODE;
  BOOKING_TARGET_REGION_LOOKUP = resolveBookingTargetRegion(BOOKING_TARGET);
  updateMapDistance(BOOKING_TARGET, "Selected: ", null, "pending");
}

function bindBookingMap() {
  const mapElement = document.getElementById("bookingMap");
  const fullscreenButton = document.getElementById("bookingMapFullscreen");
  const styleToggleButton = document.getElementById("bookingMapStyleToggle");
  const bookingPanel = document.querySelector(".booking-panel");
  const siteHeader = document.getElementById("siteHeader");
  const searchInput = document.getElementById("bookingMapSearchInput");
  const searchSubmit = document.getElementById("bookingMapSearchSubmit");
  const searchStatus = document.getElementById("bookingMapSearchStatus");
  const resetMapView = () => {
    if (!BOOKING_MAP) return;
    if (!BOOKING_PICKUP_MARKERS.length) {
      BOOKING_MAP.flyTo({ center: [121.0, 14.65], zoom: 10 });
      return;
    }
    const bounds = new window.maplibregl.LngLatBounds();
    BOOKING_PICKUP_MARKERS.forEach(({ marker }) => bounds.extend(marker.getLngLat()));
    BOOKING_MAP.fitBounds(bounds, { padding: 40, maxZoom: 11 });
  };

  const searchLocation = async () => {
    const query = searchInput.value.trim();
    if (!query) {
      searchInput.focus();
      return;
    }
    if (!BOOKING_MAP) {
      searchStatus.textContent = "The map is not ready yet. Please try again.";
      return;
    }
    BOOKING_LOCATION_SEARCH_CONTROLLER?.abort();
    BOOKING_LOCATION_SEARCH_CONTROLLER = new AbortController();
    searchStatus.textContent = "Searching for this location...";
    try {
      const response = await fetch("/api/target-location/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
        signal: BOOKING_LOCATION_SEARCH_CONTROLLER.signal
      });
      const results = await response.json();
      if (!response.ok) throw new Error(results.error || "Location search failed. Please try again.");
      const result = results[0];
      if (!result) throw new Error("No matching location was found. Try a more specific address.");
      BOOKING_MAP.flyTo({ center: [result.longitude, result.latitude], zoom: 15 });
      searchStatus.textContent = result.label || "Location found.";
      setBookingTarget({ lat: result.latitude, lng: result.longitude });
    } catch (error) {
      if (error.name === "AbortError") return;
      searchStatus.textContent = error.message || "Location search failed. Please try a different query.";
    } finally {
      BOOKING_LOCATION_SEARCH_CONTROLLER = null;
    }
  };
  searchSubmit.addEventListener("click", searchLocation);
  searchInput.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      searchLocation();
    }
  });
  document.getElementById("bookingMapSearchClear").addEventListener("click", () => {
    searchInput.value = "";
    searchStatus.textContent = "";
    searchInput.focus();
  });

  const updateFullscreenTop = () => {
    if (!BOOKING_MAP_FULLSCREEN) return;
    bookingPanel.style.setProperty("--booking-map-top", `${siteHeader.getBoundingClientRect().bottom}px`);
    window.requestAnimationFrame(() => {
      if (!BOOKING_MAP) return;
      BOOKING_MAP.resize();
    });
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
    window.requestAnimationFrame(() => {
      if (!BOOKING_MAP) return;
      BOOKING_MAP.resize();
    });
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
      BOOKING_TARGET_REGION_LOOKUP = null;
      BOOKING_GEOCODE_CONTROLLER?.abort();
      BOOKING_LOCATION_SEARCH_CONTROLLER?.abort();
      cancelBookingLocationPreview();
      cancelBookingRouteLookup();
      clearBookingNearestRoute();
      setBookingLocationPreview("");
      BOOKING_TARGET_MARKER?.remove();
      BOOKING_TARGET_MARKER = null;
      clearBookingSnapConnection();
      BOOKING_PREVIEW_MARKER?.remove();
      BOOKING_PREVIEW_MARKER = null;
      ["bookingTargetLat", "bookingTargetLng", "bookingTargetLabel", "bookingTargetRegion", "bookingNearestPickupName", "bookingNearestPickupDistance"].forEach(id => {
        document.getElementById(id).value = "";
      });
      setBookingTargetStatus("Click the map to choose your target location.");
      resetBookingMapDistancePrompt();
      searchInput.value = "";
      searchStatus.textContent = "";
      document.getElementById("bookingMapDistancePrompt").hidden = false;
      document.getElementById("bookingMapDistanceResult").hidden = true;
      updateBookingPeriodOptions(null);
      document.getElementById("bookingRentalDaysValue").textContent = `${document.getElementById("bookingRentalDays").value} days`;
      document.getElementById("bookingPromoMessage").textContent = `Enjoy ${Number(document.getElementById("bookingRentalDays").value) >= 8 ? 10 : 5}% off by selecting ${document.getElementById("bookingRentalDays").value} days.`;
      resetMapView();
      renderBookingEstimate();
    }, 0);
  });

  if (!window.maplibregl?.Map) {
    searchStatus.textContent = "The map could not load. Check the MapLibre connection and refresh.";
    setBookingTargetStatus(searchStatus.textContent);
    return;
  }
  try {
    BOOKING_MAP = new window.maplibregl.Map({
      container: mapElement,
      style: createEsriMapStyle(),
      center: [121.0, 14.65],
      zoom: 10,
      cooperativeGestures: true,
      attributionControl: false
    });
    bindMapStyleToggle(BOOKING_MAP, styleToggleButton);
    BOOKING_MAP.addControl(new window.maplibregl.NavigationControl({ showCompass: false }), "top-right");
    BOOKING_MAP.on("load", () => {
      addCollapsedMapAttribution(BOOKING_MAP);
      BOOKING_MAP.addSource("booking-snap-connection", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
      });
      BOOKING_MAP.addLayer({
        id: "booking-snap-connection-line",
        type: "line",
        source: "booking-snap-connection",
        paint: {
          "line-color": "#404040",
          "line-width": 2.5,
          "line-dasharray": [1, 2]
        }
      });
      BOOKING_MAP.addSource("booking-nearest-route", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
      });
      BOOKING_MAP.addLayer({
        id: "booking-nearest-route-casing",
        type: "line",
        source: "booking-nearest-route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#ffffff",
          "line-width": 7,
          "line-opacity": 0.88
        }
      });
      BOOKING_MAP.addLayer({
        id: "booking-nearest-route-line",
        type: "line",
        source: "booking-nearest-route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": 4,
          "line-opacity": 0.95
        }
      });
      if (BOOKING_TARGET?.snappedDistanceMeters) {
        showBookingSnapConnection(BOOKING_TARGET);
      }
      BOOKING_PICKUP_MARKERS = PICKUP_POINTS.map(point => ({
        point,
        marker: new window.maplibregl.Marker({
          element: createPickupMapMarkerElement(point.color),
          anchor: "bottom"
        }).setLngLat([point.lng, point.lat]).addTo(BOOKING_MAP)
      }));
      resetMapView();
      searchSubmit.disabled = false;
      searchStatus.textContent = "";
      document.getElementById("bookingMapDistancePrompt").textContent = "Move the cursor over the map to preview road distance from the nearest pickup point.";
      setBookingTargetStatus("Click the map or search for a location to choose your target.");
      restoreBookingTargetFromDraft();
    });
    BOOKING_MAP.on("mousemove", event => {
      if (BOOKING_TARGET) return;
      const position = { lat: event.lngLat.lat, lng: event.lngLat.lng };
      const nearest = updateMapDistance(position);
      scheduleBookingRoutePreview(position);
      scheduleBookingLocationPreview(position);
      const markerOptions = {
        element: createBookingMapMarkerElement(nearest.color, true),
        anchor: "bottom"
      };
      if (BOOKING_PREVIEW_MARKER) {
        BOOKING_PREVIEW_MARKER.setLngLat([position.lng, position.lat]);
        BOOKING_PREVIEW_MARKER.getElement().style.setProperty("--marker-color", nearest.color);
      } else {
        BOOKING_PREVIEW_MARKER = new window.maplibregl.Marker(markerOptions)
          .setLngLat([position.lng, position.lat])
          .addTo(BOOKING_MAP);
      }
    });
    BOOKING_MAP.on("mouseout", () => {
      if (BOOKING_TARGET) {
        updateMapDistance(BOOKING_TARGET, "Selected: ");
        return;
      }
      cancelBookingLocationPreview();
      cancelBookingRouteLookup();
      clearBookingNearestRoute();
      setBookingLocationPreview("");
      resetBookingMapDistancePrompt();
      document.getElementById("bookingMapDistancePrompt").hidden = false;
      document.getElementById("bookingMapDistanceResult").hidden = true;
      BOOKING_PREVIEW_MARKER?.remove();
      BOOKING_PREVIEW_MARKER = null;
      BOOKING_PICKUP_MARKERS.forEach(({ marker }) => marker.getElement().classList.remove("is-nearest"));
    });
    BOOKING_MAP.on("click", event => {
      setBookingTarget({ lat: event.lngLat.lat, lng: event.lngLat.lng });
    });
    BOOKING_MAP.on("error", event => {
      console.error("The booking map encountered a tile or style error.", event.error);
      searchStatus.textContent = "Some map content could not be loaded.";
    });
  } catch (error) {
    searchSubmit.disabled = true;
    searchStatus.textContent = error.message || "The booking map could not be initialized.";
    setBookingTargetStatus(searchStatus.textContent);
    console.error("The booking map could not be initialized.", error);
  }
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
  const toUtcDay = value => {
    const [year, month, day] = value.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };
  const elapsedDays = (toUtcDay(returnDate) - toUtcDay(pickup)) / 86400000;
  const isCustomDays = BOOKING_RENTAL_MODE === "custom_days";
  const selectedPeriod = Number(document.querySelector('input[name="bookingPeriod"]:checked')?.value || 0);
  const rentalDays = isCustomDays ? Number(document.getElementById("bookingRentalDays").value) : 1;
  const periodHours = region === "luzon" || isCustomDays ? 24 : selectedPeriod;
  if (isCustomDays && !BOOKING_DURATION_SELECTED) {
    summary.textContent = "Choose a custom rental length to see your quote.";
    subtotal.textContent = "—";
    deposit.textContent = "—";
    discountRow.hidden = true;
    return;
  }
  if (BOOKING_RENTAL_MODE !== "hourly" && !isCustomDays) {
    summary.textContent = "Choose a rental arrangement to see your quote.";
    subtotal.textContent = "—";
    deposit.textContent = "—";
    discountRow.hidden = true;
    return;
  }
  if (BOOKING_RENTAL_MODE === "hourly" && selectedPeriod !== 12 && selectedPeriod !== 24) {
    estimate.hidden = false;
    summary.textContent = "Choose a 12- or 24-hour rental period to see your quote.";
    subtotal.textContent = "—";
    deposit.textContent = "—";
    discountRow.hidden = true;
    return;
  }
  const pickupTime = document.getElementById("bookingPickupTime").value;
  const expectedElapsedDays = isCustomDays
    ? rentalDays
    : Math.floor((Number(pickupTime.slice(0, 2)) * 60 + Number(pickupTime.slice(3, 5)) + selectedPeriod * 60) / 1440);
  if (!Number.isInteger(elapsedDays) || elapsedDays !== expectedElapsedDays
    || (isCustomDays && (rentalDays < 4 || rentalDays > 15))) {
    summary.textContent = isCustomDays
      ? "Set a valid pickup date and 4–15 day custom rental duration."
      : "The return date must match your pickup time and selected rental period.";
    subtotal.textContent = "—";
    deposit.textContent = "—";
    discountRow.hidden = true;
    return;
  }
  const promoPercent = Number(DISCOUNT_RULES.find(rule =>
    isCustomDays && rentalDays >= Number(rule.minDays) && rentalDays <= Number(rule.maxDays)
  )?.percent) || 0;
  document.getElementById("bookingPromoMessage").textContent = isCustomDays
    ? promoPercent
      ? `Enjoy ${promoPercent}% off on your ${rentalDays}-day custom arrangement.`
      : "No long-rental discount applies to this duration."
    : "Hourly rental is priced as one 12- or 24-hour block; custom-day discounts do not apply.";
  const effectivePeriod = periodHours || 24;
  const rateField = region === "in"
    ? effectivePeriod === 12 ? "in12_rate" : "in24_rate"
    : region === "out"
      ? effectivePeriod === 12 ? "out12_rate" : "out24_rate"
      : "luzon_rate";
  const rate = Number(car[rateField]);
  const rentalHours = isCustomDays ? rentalDays * 24 : effectivePeriod;
  const rateBlocks = isCustomDays ? rentalHours / effectivePeriod : 1;
  const undiscountedSubtotal = rate * rateBlocks;
  const discountPercent = isCustomDays ? promoPercent : 0;
  const promoDiscount = Math.round(undiscountedSubtotal * discountPercent) / 100;
  const rentalSubtotal = undiscountedSubtotal - promoDiscount;
  BOOKING_RATE_QUOTE = {
    rateRegion: region,
    rentalMode: BOOKING_RENTAL_MODE,
    periodHours: effectivePeriod,
    rentalHours,
    rentalDays,
    rateBlocks,
    unitRate: rate,
    discountPercent,
    discountAmount: promoDiscount,
    total: rentalSubtotal
  };
  const arrangementSummary = isCustomDays
    ? `${rentalDays} days · ${rateBlocks} × 24-hour ${regionDisplayName(region)} rate`
    : `One ${effectivePeriod}-hour ${regionDisplayName(region)} rate`;
  summary.textContent = `${arrangementSummary} at ${formatCurrency(rate, SETTINGS.currency)}${discountPercent ? ` · ${discountPercent}% promo` : ""}`;
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
  const modeOptions = document.querySelectorAll('input[name="bookingMode"]');
  document.getElementById("bookingPickupTime").addEventListener("change", event => {
    event.currentTarget.blur();
  });
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
    durationDetails.classList.toggle("duration-unselected", !BOOKING_DURATION_SELECTED);
    daysOutput.textContent = BOOKING_DURATION_SELECTED ? `${days} days` : "--";
    promoMessage.textContent = BOOKING_DURATION_SELECTED
      ? `Enjoy ${percentage}% off on your ${days}-day custom arrangement.`
      : "Choose a custom day arrangement to unlock 4–7 day and 8–15 day discounts.";
  };

  durationSummary.setAttribute("aria-expanded", "false");
  durationSummary.addEventListener("click", event => {
    event.preventDefault();
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

  const bookingPeriodField = document.getElementById("bookingPeriodField");
  modeOptions.forEach(input => {
    const modeClass = input.value === "hourly" ? "hourly-hover-preview" : "custom-hover-preview";
    const otherModeClass = input.value === "hourly" ? "custom-hover-preview" : "hourly-hover-preview";
    const previewMode = enabled => {
      bookingPeriodField.classList.toggle(modeClass, enabled && BOOKING_RENTAL_MODE !== input.value);
    };
    input.closest("label").addEventListener("pointerenter", event => {
      if (hoverCanExpand.matches && event.pointerType !== "touch") {
        bookingPeriodField.classList.remove(otherModeClass);
        previewMode(true);
        if (input.value === "custom_days") {
          durationHovering = true;
          setDurationOpen(true);
        }
      }
    });
    input.addEventListener("focus", () => {
      bookingPeriodField.classList.remove(otherModeClass);
      previewMode(true);
      if (input.value === "custom_days") setDurationOpen(true);
    });
    input.addEventListener("blur", () => {
      previewMode(false);
      if (input.value === "custom_days" && !durationPinnedOpen && BOOKING_RENTAL_MODE !== "custom_days") {
        durationHovering = false;
        setDurationOpen(false);
      }
    });
  });
  bookingPeriodField.addEventListener("pointerleave", () => {
    bookingPeriodField.classList.remove("hourly-hover-preview", "custom-hover-preview");
    if (!durationPinnedOpen && BOOKING_RENTAL_MODE !== "custom_days") {
      durationHovering = false;
      setDurationOpen(false);
    }
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
      if (BOOKING_RENTAL_MODE === "hourly") {
        const period = Number(document.querySelector('input[name="bookingPeriod"]:checked')?.value || 0);
        const pickupTime = document.getElementById("bookingPickupTime").value;
        if (period && pickupTime) {
          const [hour, minute] = pickupTime.split(":").map(Number);
          const dayOffset = Math.floor((hour * 60 + minute + period * 60) / 1440);
          const [year, month, day] = pickup.split("-").map(Number);
          const returnDate = new Date(Date.UTC(year, month - 1, day + dayOffset));
          returnInput.value = returnDate.toISOString().slice(0, 10);
        } else {
          returnInput.value = "";
        }
      } else if (BOOKING_RENTAL_MODE === "custom_days") {
        const [year, month, day] = pickup.split("-").map(Number);
        const returnDate = new Date(Date.UTC(year, month - 1, day + days));
        returnInput.value = returnDate.toISOString().slice(0, 10);
      } else {
        returnInput.value = "";
      }
      returnInput.min = pickup;
    } else {
      returnInput.value = "";
    }
    renderBookingEstimate();
  };
  const applyRentalMode = mode => {
    BOOKING_RENTAL_MODE = mode;
    const periodField = document.getElementById("bookingPeriodField");
    periodField.classList.toggle("hourly-selected", mode === "hourly");
    periodField.classList.toggle("custom-selected", mode === "custom_days");
    if (mode === "custom_days") {
      durationPinnedOpen = true;
      setDurationOpen(true);
    } else {
      closeDuration();
    }
    syncReturnDate();
  };
  pickupInput.addEventListener("change", syncReturnDate);
  document.getElementById("bookingPickupTime").addEventListener("change", syncReturnDate);
  daysInput.addEventListener("input", () => {
    BOOKING_DURATION_SELECTED = true;
    syncReturnDate();
  });
  daysInput.addEventListener("click", () => {
    BOOKING_DURATION_SELECTED = true;
    updateDurationPromo();
    renderBookingEstimate();
  });
  modeOptions.forEach(input => {
    input.addEventListener("change", () => {
      if (input.value === "custom_days") {
        document.getElementById("bookingPeriod12").checked = false;
        document.getElementById("bookingPeriod24").checked = false;
      }
      applyRentalMode(input.value);
    });
  });
  document.querySelectorAll('input[name="bookingPeriod"]').forEach(input => {
    input.addEventListener("change", () => {
      BOOKING_RENTAL_MODE = "hourly";
      document.getElementById("bookingModeHourly").checked = true;
      document.getElementById("bookingModeCustom").checked = false;
      const periodField = document.getElementById("bookingPeriodField");
      periodField.classList.add("hourly-selected");
      periodField.classList.remove("custom-selected");
      syncReturnDate();
      updateDurationPromo();
      renderBookingEstimate();
    });
  });
  ["bookingLastName", "bookingFirstName"].forEach(id => {
    document.getElementById(id).addEventListener("input", renderBookingEstimate);
  });
  document.getElementById("bookingForm").addEventListener("reset", () => {
    window.setTimeout(() => {
      BOOKING_DURATION_SELECTED = false;
      BOOKING_RENTAL_MODE = null;
      document.querySelectorAll('input[name="bookingMode"]').forEach(option => {
        option.checked = false;
      });
      document.getElementById("bookingPeriodField").classList.remove("hourly-selected", "custom-selected");
      ["bookingFirstName", "bookingLastName", "bookingMiddleName", "bookingSuffix", "bookingPhone", "bookingEmail", "bookingNotes", "guestEmailCode"].forEach(id => {
        document.getElementById(id).value = "";
      });
      document.getElementById("guestEmailCodeRow").hidden = true;
      document.getElementById("guestEmailVerificationStatus").textContent = "";
      document.getElementById("guestEmailVerificationStatus").className = "";
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
  const guestEmailInput = document.getElementById("bookingEmail");
  const guestEmailFieldNote = document.getElementById("bookingEmailNote");
  const guestVerification = document.getElementById("guestEmailVerification");
  const guestEmailCodeRow = document.getElementById("guestEmailCodeRow");
  const guestEmailCodeInput = document.getElementById("guestEmailCode");
  const guestVerificationStatus = document.getElementById("guestEmailVerificationStatus");
  const sendGuestEmailCodeButton = document.getElementById("sendGuestEmailCode");
  const verifyGuestEmailCodeButton = document.getElementById("verifyGuestEmailCode");
  const recapDialog = document.getElementById("reservationRecap");
  const recapCloseButton = document.getElementById("recapCloseButton");
  const recapEditButton = document.getElementById("recapEditButton");
  const recapConfirmButton = document.getElementById("recapConfirmButton");
  const recapError = document.getElementById("recapError");
  let currentUser = null;
  let pendingInquiry = null;
  let isSendingInquiry = false;
  let isResolvingDestination = false;
  let guestEmailChallengeId = null;
  let guestEmailChallengeAddress = null;
  let guestEmailVerificationToken = null;
  let guestEmailVerifiedAddress = null;
  let isRequestingGuestCode = false;
  let isVerifyingGuestCode = false;

  const hasVerifiedGoogleAccount = user => {
    const providers = [
      user?.app_metadata?.provider,
      ...(Array.isArray(user?.app_metadata?.providers) ? user.app_metadata.providers : []),
      ...(Array.isArray(user?.identities) ? user.identities.map(identity => identity.provider) : [])
    ];
    const profileEmailVerified = user?.user_metadata?.email_verified === true
      || user?.user_metadata?.email_verified === "true";
    return providers.includes("google") && (profileEmailVerified || Boolean(user?.email_confirmed_at || user?.confirmed_at));
  };
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
  const setGuestVerificationStatus = (message, state = "") => {
    guestVerificationStatus.textContent = message;
    guestVerificationStatus.className = state ? `is-${state}` : "";
  };
  const resetGuestEmailVerification = () => {
    guestEmailChallengeId = null;
    guestEmailChallengeAddress = null;
    guestEmailVerificationToken = null;
    guestEmailVerifiedAddress = null;
    guestEmailCodeRow.hidden = true;
    guestEmailCodeInput.value = "";
    setGuestVerificationStatus("");
    sendGuestEmailCodeButton.disabled = false;
    sendGuestEmailCodeButton.hidden = false;
    sendGuestEmailCodeButton.textContent = "Send verification code";
  };
  form.addEventListener("reset", resetGuestEmailVerification);
  const updateVerificationUI = () => {
    const isGoogle = hasVerifiedGoogleAccount(currentUser);
    const phoneInput = document.getElementById("bookingPhone");
    document.getElementById("bookingGuestNote").hidden = isGoogle;
    const profile = currentUser?.user_metadata || {};
    const profilePhone = String(profile.phone_number || profile.phone || "").trim();
    googleButton.hidden = false;
    nameFields.hidden = false;
    nameFields.querySelectorAll(".booking-profile-field").forEach(field => {
      field.hidden = isGoogle;
      field.querySelectorAll("input").forEach(input => {
        input.disabled = isGoogle;
      });
    });
    guestEmailInput.disabled = isGoogle;
    guestEmailInput.required = !isGoogle;
    guestEmailInput.value = isGoogle ? currentUser.email || "" : guestEmailInput.value;
    guestEmailFieldNote.textContent = isGoogle ? "from Google" : "required for guests";
    guestVerification.hidden = isGoogle;
    if (isGoogle) resetGuestEmailVerification();
    phoneInput.required = true;
    if (isGoogle && profilePhone) phoneInput.value = profilePhone;
    if (isGoogle) {
      googleButton.innerHTML = '<i class="fa-brands fa-google" aria-hidden="true"></i> SIGN OUT';
      googleButton.setAttribute("aria-label", "Sign out of Google");
      authCopy.textContent = "Your details are ready from Google—signing in saves you time.";
      authStatus.textContent = `Signed in as ${getGoogleProfileName(currentUser) || currentUser.email}. Google verified this email.`;
      if (sessionStorage.getItem(signInPendingKey) === "true") {
        sessionStorage.removeItem(signInPendingKey);
        showAuthToast("Signed in successfully.");
      }
    } else {
      googleButton.innerHTML = '<i class="fa-brands fa-google" aria-hidden="true"></i> Continue with Google';
      googleButton.setAttribute("aria-label", "Continue with Google");
      authCopy.textContent = "Continue with Google to prefill your details and save time.";
      authStatus.textContent = "Or verify your email below to send your inquiry as a guest.";
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
      BOOKING_RENTAL_MODE = document.querySelector('input[name="bookingMode"]:checked')?.value || null;
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
    Array.from(form.elements).forEach(input => {
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
      firstName: hasVerifiedGoogleAccount(currentUser) ? "" : document.getElementById("bookingFirstName").value.trim(),
      lastName: hasVerifiedGoogleAccount(currentUser) ? "" : document.getElementById("bookingLastName").value.trim(),
      middleName: hasVerifiedGoogleAccount(currentUser) ? "" : document.getElementById("bookingMiddleName").value.trim(),
      suffix: hasVerifiedGoogleAccount(currentUser) ? "" : document.getElementById("bookingSuffix").value.trim(),
      googleAuthenticated: hasVerifiedGoogleAccount(currentUser),
      emailVerificationToken: guestEmailVerificationToken,
      email: hasVerifiedGoogleAccount(currentUser)
        ? currentUser.email || ""
        : enteredEmail && emailInput.validity.valid ? enteredEmail : "",
      phone: document.getElementById("bookingPhone").value.trim(),
      carId,
      carName: car ? car.name : "Unknown",
      rentalMode: BOOKING_RENTAL_MODE,
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
    const result = await DB.addInquiry({ ...inquiry, ...options });
    sessionStorage.removeItem(draftKey);
    form.reset();
    msg.className = "form-msg success";
    msg.textContent = result.emailNotificationSent
      ? `Thanks, ${inquiry.name}. Your inquiry was received. A confirmation email is on its way.`
      : `Thanks, ${inquiry.name}. Your inquiry was received, but we couldn't send the confirmation email. Our team will follow up using your phone number.`;
    updateVerificationUI();
  };

  const formatRecapDate = value => new Date(`${value}T00:00:00`).toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });

  const openReservationRecap = inquiry => {
    document.getElementById("recapName").textContent = inquiry.name;
    document.getElementById("recapEmail").textContent = inquiry.email || currentUser?.email || "—";
    document.getElementById("recapCar").textContent = inquiry.carName;
    document.getElementById("recapCapacity").textContent = inquiry.capacity ?? "—";
    document.getElementById("recapPickupDate").textContent = formatRecapDate(inquiry.pickupDate);
    document.getElementById("recapPickupTime").textContent = inquiry.pickupTime;
    document.getElementById("recapReturnDate").textContent = formatRecapDate(inquiry.returnDate);
    document.getElementById("recapTargetLocation").textContent = inquiry.location;
    document.getElementById("recapNearestPickup").textContent = `${inquiry.nearestPickupDistanceKm.toFixed(2)} km from ${inquiry.nearestPickupName}`;
    document.getElementById("recapRateBasis").textContent = `${regionDisplayName(inquiry.rateRegion)} · ${inquiry.rentalMode === "hourly" ? "one" : `${inquiry.rentalDays}`} ${inquiry.rentalMode === "hourly" ? `${inquiry.rentalPeriodHours}-hour block` : `days at 24-hour rates`} at ${formatCurrency(inquiry.ratePerPeriod, SETTINGS.currency)}`;
    document.getElementById("recapRentalDays").textContent = inquiry.rentalMode === "hourly"
      ? `${inquiry.rentalPeriodHours} hours`
      : `${inquiry.rentalDays} days`;
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
    pendingInquiry = { ...inquiry, email: inquiry.email || currentUser?.email || "" };
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
    const isGoogle = hasVerifiedGoogleAccount(currentUser);
    if (!isGoogle && (!guestEmailVerificationToken || guestEmailVerifiedAddress !== pendingInquiry.email.toLowerCase())) {
      recapError.textContent = "Verify your email address before confirming this guest inquiry.";
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
        userId: isGoogle ? currentUser.id : null,
        verificationMethod: isGoogle ? "google_oauth" : "email_otp",
        status: "pending_review"
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

  guestEmailInput.addEventListener("input", () => {
    const email = guestEmailInput.value.trim().toLowerCase();
    if ((guestEmailVerificationToken || guestEmailChallengeId)
      && email !== (guestEmailVerifiedAddress || guestEmailChallengeAddress)) {
      resetGuestEmailVerification();
      setGuestVerificationStatus("Email changed. Request a new verification code.");
      sendGuestEmailCodeButton.textContent = "Send verification code";
    }
  });
  sendGuestEmailCodeButton.addEventListener("click", async () => {
    const email = guestEmailInput.value.trim().toLowerCase();
    if (!guestEmailInput.validity.valid || !email) {
      setGuestVerificationStatus("Enter a valid email address first.", "error");
      guestEmailInput.focus();
      return;
    }
    if (isRequestingGuestCode) return;
    isRequestingGuestCode = true;
    sendGuestEmailCodeButton.disabled = true;
    setGuestVerificationStatus("Sending verification code…");
    try {
      const result = await DB.requestGuestEmailCode(email);
      guestEmailChallengeId = result.challengeId;
      guestEmailChallengeAddress = email;
      guestEmailVerifiedAddress = null;
      guestEmailVerificationToken = null;
      guestEmailCodeRow.hidden = false;
      sendGuestEmailCodeButton.disabled = false;
      sendGuestEmailCodeButton.textContent = "Resend code";
      guestEmailCodeInput.focus();
      setGuestVerificationStatus("Code sent. Check your inbox and spam folder.");
    } catch (error) {
      setGuestVerificationStatus(error.message || "Could not send a verification code.", "error");
      sendGuestEmailCodeButton.disabled = false;
    } finally {
      isRequestingGuestCode = false;
    }
  });
  verifyGuestEmailCodeButton.addEventListener("click", async () => {
    if (!guestEmailChallengeId || isVerifyingGuestCode) {
      setGuestVerificationStatus("Request a verification code first.", "error");
      return;
    }
    const code = guestEmailCodeInput.value.trim();
    if (guestEmailInput.value.trim().toLowerCase() !== guestEmailChallengeAddress) {
      resetGuestEmailVerification();
      setGuestVerificationStatus("Email changed. Request a new verification code.", "error");
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      setGuestVerificationStatus("Enter the six-digit code from your email.", "error");
      guestEmailCodeInput.focus();
      return;
    }
    isVerifyingGuestCode = true;
    verifyGuestEmailCodeButton.disabled = true;
    setGuestVerificationStatus("Verifying code…");
    try {
      const result = await DB.verifyGuestEmailCode(guestEmailChallengeId, code);
      guestEmailVerificationToken = result.verificationToken;
      guestEmailVerifiedAddress = guestEmailChallengeAddress;
      guestEmailChallengeId = null;
      guestEmailCodeRow.hidden = true;
      sendGuestEmailCodeButton.hidden = true;
      guestEmailCodeInput.value = "";
      setGuestVerificationStatus("Email verified. You can submit your inquiry.", "verified");
    } catch (error) {
      setGuestVerificationStatus(error.message || "Could not verify that code.", "error");
    } finally {
      isVerifyingGuestCode = false;
      verifyGuestEmailCodeButton.disabled = false;
    }
  });
  guestEmailInput.addEventListener("change", () => {
    const email = guestEmailInput.value.trim().toLowerCase();
    if ((guestEmailVerificationToken || guestEmailChallengeId)
      && email !== (guestEmailVerifiedAddress || guestEmailChallengeAddress)) {
      resetGuestEmailVerification();
      sendGuestEmailCodeButton.textContent = "Send verification code";
    }
  });

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
    if (isResolvingDestination) return;
    const selectedTarget = BOOKING_TARGET;
    if (selectedTarget && !selectedTarget.verified && BOOKING_TARGET_REGION_LOOKUP) {
      isResolvingDestination = true;
      const submitLabel = submitButton.textContent;
      submitButton.disabled = true;
      submitButton.textContent = "Checking destination…";
      msg.textContent = "Checking the selected destination and its rate…";
      try {
        await BOOKING_TARGET_REGION_LOOKUP;
      } finally {
        isResolvingDestination = false;
        submitButton.disabled = false;
        submitButton.textContent = submitLabel;
      }
      if (BOOKING_TARGET !== selectedTarget) {
        msg.className = "form-msg error";
        msg.textContent = "The selected destination changed while it was being checked. Submit again to continue.";
        return;
      }
    }
    const inquiry = collectInquiry();
    const lastName = document.getElementById("bookingLastName").value.trim();
    const firstName = document.getElementById("bookingFirstName").value.trim();
    const isGoogle = hasVerifiedGoogleAccount(currentUser);

    const capacityInput = document.getElementById("bookingCapacity");
    if (capacityInput.value && (!Number.isInteger(Number(capacityInput.value)) || Number(capacityInput.value) < 1)) {
      msg.className = "form-msg error";
      msg.textContent = "Capacity must be a whole number greater than zero.";
      capacityInput.focus();
      return;
    }
    if ((!isGoogle && (!lastName || !firstName)) || (isGoogle && !inquiry.name) || !inquiry.carId || !inquiry.pickupDate || !inquiry.pickupTime) {
      msg.className = "form-msg error";
      msg.textContent = isGoogle && !inquiry.name
        ? "Your Google account did not provide a profile name. Add a name to your Google profile and sign in again."
        : "Please fill in your name, unit, pickup date, and pickup time.";
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
      msg.textContent = "Enter a valid email address.";
      emailInput.focus();
      return;
    }
    if (!isGoogle && !emailInput.value.trim()) {
      msg.className = "form-msg error";
      msg.textContent = "Enter the email address you want us to verify.";
      emailInput.focus();
      return;
    }
    if (!BOOKING_RENTAL_MODE) {
      msg.className = "form-msg error";
      msg.textContent = "Choose either a 12/24-hour rental or a custom day arrangement.";
      document.getElementById("bookingPeriodField").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (BOOKING_RENTAL_MODE === "hourly" && BOOKING_TARGET?.rateRegion !== "luzon"
      && !document.querySelector('input[name="bookingPeriod"]:checked')) {
      msg.className = "form-msg error";
      msg.textContent = "Choose either the 12-hour or 24-hour rental period.";
      document.getElementById("bookingPeriodField").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (BOOKING_RENTAL_MODE === "custom_days" && !BOOKING_DURATION_SELECTED) {
      msg.className = "form-msg error";
      msg.textContent = "Choose a custom rental length using the 4–15 day slider.";
      document.getElementById("bookingDurationDetails").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (!inquiry.returnDate) {
      msg.className = "form-msg error";
      msg.textContent = BOOKING_RENTAL_MODE === "hourly"
        ? "Choose a pickup time to calculate the return date."
        : "Choose a pickup date to calculate your custom rental dates.";
      return;
    }
    if (!BOOKING_TARGET) {
      msg.className = "form-msg error";
      msg.textContent = "Choose your target location on the map before continuing.";
      document.getElementById("bookingMap").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (!BOOKING_TARGET.verified) {
      msg.className = "form-msg error";
      msg.textContent = "Wait for the map to verify your destination, or choose another location.";
      return;
    }
    if (!BOOKING_TARGET.rateRegion) {
      msg.className = "form-msg error";
      msg.textContent = document.getElementById("bookingTargetStatus").textContent.includes("Could not identify")
        ? "We couldn't identify this destination. Click a clearer location on the map and try again."
        : "This destination isn't within the supported Luzon pricing area. Choose another location on the map.";
      return;
    }
    if (new Date(inquiry.returnDate) < new Date(inquiry.pickupDate)) {
      msg.className = "form-msg error";
      msg.textContent = "Return date can't be earlier than the pickup date.";
      return;
    }
    if (!BOOKING_RATE_QUOTE) {
      msg.className = "form-msg error";
      msg.textContent = "Choose a unit and valid rental dates to calculate your rate.";
      return;
    }
    if (!isGoogle && (!guestEmailVerificationToken
      || guestEmailVerifiedAddress !== inquiry.email.toLowerCase())) {
      msg.className = "form-msg error";
      msg.textContent = "Verify your email using the code sent to your inbox before continuing.";
      guestVerification.scrollIntoView({ behavior: "smooth", block: "center" });
      if (!guestEmailChallengeId) sendGuestEmailCodeButton.focus();
      else guestEmailCodeInput.focus();
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
