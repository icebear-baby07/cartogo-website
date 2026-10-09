/* ==========================================================================
   carTOGO.mnl — PUBLIC SITE LOGIC (js/main.js)
   Reads content from DB (js/data.js) and renders it into index.html.
   Nothing here writes settings/labels/cars — only visitor inquiries.
   ========================================================================== */

let CARS = [];
let SETTINGS = {};
let LABELS = {};
let activeFilter = "All";

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
  renderAbout();
  renderFaq();
  renderContact();
  renderFooter();
  populateCarSelect();
  bindNav();
  bindBookingForm();
  bindQuickSearch();
  bindFaqToggles();
}

/* ---------- Brand / header ---------- */
function renderBrand() {
  document.querySelectorAll("[data-company-name]").forEach(el => {
    el.textContent = SETTINGS.companyName;
  });
}

/* ---------- Hero ---------- */
function renderHero() {
  document.getElementById("heroTitle").innerHTML = LABELS.hero.title;
  document.getElementById("heroSubtitle").textContent = LABELS.hero.subtitle;
}

/* ---------- Trust strip ---------- */
function renderTrustStrip() {
  const wrap = document.getElementById("trustGrid");
  wrap.innerHTML = LABELS.trustStrip.map(item => `
    <div class="trust-item">
      <b>${escapeHtml(item.value)}</b>
      <span>${escapeHtml(item.label)}</span>
    </div>
  `).join("");
}

/* ---------- Fleet filters ---------- */
function renderFilters() {
  const categories = ["All", ...new Set(CARS.map(c => c.category))];
  const wrap = document.getElementById("filterRow");
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
        <span class="avail ${car.available ? "" : "out"}">${car.available ? "Available" : "Booked out"}</span>
      </div>
      <div class="car-body">
        <h3>${escapeHtml(car.name)}</h3>
        <div class="car-specs">
          <span><i class="fa-solid fa-user" aria-hidden="true"></i> ${escapeHtml(String(car.seats))} seats</span>
          <span><i class="fa-solid fa-gear" aria-hidden="true"></i> ${escapeHtml(car.transmission)}</span>
          <span><i class="fa-solid fa-gas-pump" aria-hidden="true"></i> ${escapeHtml(car.fuel)}</span>
        </div>
        <p class="car-blurb">${escapeHtml(car.blurb)}</p>
        <div class="car-foot">
          <div class="car-rate">
            <b>${formatCurrency(car.rate, SETTINGS.currency)}</b>
            <span>per day</span>
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
}

/* ---------- Rates table ---------- */
function renderRates() {
  const tbody = document.getElementById("ratesBody");
  tbody.innerHTML = CARS.map(car => `
    <tr>
      <td>${escapeHtml(car.name)}</td>
      <td>${escapeHtml(car.category)}</td>
      <td class="num">${formatCurrency(car.rate, SETTINGS.currency)}</td>
      <td class="num">${formatCurrency(car.rate * 7 * 0.9, SETTINGS.currency)}</td>
      <td class="num">${formatCurrency(Math.round(car.rate * SETTINGS.depositPercent / 100), SETTINGS.currency)}</td>
    </tr>
  `).join("");

  document.getElementById("feesGrid").innerHTML = `
    <div class="fee-chip"><b>${formatCurrency(SETTINGS.extraDriverFee, SETTINGS.currency)}</b><span>Extra driver / trip</span></div>
    <div class="fee-chip"><b>${formatCurrency(SETTINGS.childSeatFee, SETTINGS.currency)}</b><span>Child seat / trip</span></div>
    <div class="fee-chip"><b>${formatCurrency(SETTINGS.lateFeePerHour, SETTINGS.currency)}</b><span>Late return / hour</span></div>
    <div class="fee-chip"><b>${SETTINGS.depositPercent}%</b><span>Refundable deposit</span></div>
  `;
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
  document.getElementById("contactLocations").innerHTML = c.locations.map(loc => `<li><i class="fa-solid fa-location-dot" aria-hidden="true"></i> ${escapeHtml(loc)}</li>`).join("");
}

/* ---------- About ---------- */
function renderAbout() {
  document.getElementById("aboutTitle").textContent = LABELS.about.title;
  document.getElementById("aboutBody").textContent = LABELS.about.body;
}

/* ---------- Footer ---------- */
function renderFooter() {
  document.getElementById("footerAbout").textContent = LABELS.about.body;
  document.getElementById("footerYear").textContent = new Date().getFullYear();
  document.getElementById("footerLocations").innerHTML = LABELS.contact.locations
    .map(loc => `<li>${escapeHtml(loc.split("—")[0].trim())}</li>`).join("");
}

/* ---------- Booking form select ---------- */
function populateCarSelect() {
  const select = document.getElementById("bookingCar");
  select.innerHTML = `<option value="">Select a car</option>` +
    CARS.map(c => `<option value="${c.id}">${escapeHtml(c.name)} — ${formatCurrency(c.rate, SETTINGS.currency)}/day</option>`).join("");

  const location = document.getElementById("bookingLocation");
  location.innerHTML = LABELS.contact.locations
    .map(loc => loc.split("—")[0].trim())
    .map(loc => `<option value="${escapeHtml(loc)}">${escapeHtml(loc)}</option>`).join("");
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
    document.getElementById("fleet").scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

/* ---------- Booking / inquiry form ---------- */
function bindBookingForm() {
  const form = document.getElementById("bookingForm");
  const msg = document.getElementById("formMsg");
  const phoneFields = [
    { input: document.getElementById("bookingPhone"), error: document.getElementById("bookingPhoneError") },
    { input: document.getElementById("bookingSecondaryPhone"), error: document.getElementById("bookingSecondaryPhoneError") }
  ];

  phoneFields.forEach(({ input, error }) => {
    input.addEventListener("input", () => {
      const hasInvalidCharacters = /[^0-9-]/.test(input.value);
      input.classList.toggle("phone-invalid", hasInvalidCharacters);
      error.hidden = !hasInvalidCharacters;
    });
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.className = "form-msg";
    msg.textContent = "";

    const lastName = document.getElementById("bookingLastName").value.trim();
    const firstName = document.getElementById("bookingFirstName").value.trim();
    const middleName = document.getElementById("bookingMiddleName").value.trim();
    const nameExtension = document.getElementById("bookingSuffix").value.trim();
    const nameParts = [lastName, firstName, middleName].filter(Boolean);
    let name = `${nameParts[0]}, ${nameParts.slice(1).join(" ")}`;
    if (nameExtension) name += `, ${nameExtension}`;
    const email = document.getElementById("bookingEmail").value.trim();
    const phone = document.getElementById("bookingPhone").value.trim();
    const secondaryPhone = document.getElementById("bookingSecondaryPhone").value.trim();
    const carId = document.getElementById("bookingCar").value;
    const pickupDate = document.getElementById("bookingPickup").value;
    const returnDate = document.getElementById("bookingReturn").value;
    const location = document.getElementById("bookingLocation").value;
    const notes = document.getElementById("bookingNotes").value.trim();

    if (!lastName || !firstName || !email || !phone || !carId || !pickupDate || !returnDate) {
      msg.className = "form-msg error";
      msg.textContent = "Please fill in your last name, first name, email, phone, car, and both dates before submitting.";
      return;
    }
    if (!isValidPhone(phone) || (secondaryPhone && !isValidPhone(secondaryPhone))) {
      msg.className = "form-msg error";
      msg.textContent = "Please use 09xx-xxx-xxx for each phone number. Country codes are not accepted.";
      return;
    }
    if (new Date(returnDate) < new Date(pickupDate)) {
      msg.className = "form-msg error";
      msg.textContent = "Return date can't be earlier than the pickup date.";
      return;
    }

    const car = CARS.find(c => c.id === carId);
    const submitBtn = form.querySelector("[type=submit]");
    submitBtn.disabled = true;
    submitBtn.textContent = "Sending…";

    try {
      const record = await DB.addInquiry({
        name, email, phone, secondaryPhone,
        carId, carName: car ? car.name : "Unknown",
        pickupDate, returnDate, location, notes
      });
      msg.className = "form-msg success";
      msg.textContent = `Thanks, ${name} - your inquiry is in! Your reservation has been successfully saved to our cloud database.`;
      form.reset();
      phoneFields.forEach(({ input, error }) => {
        input.classList.remove("phone-invalid");
        error.hidden = true;
      });
    } catch (err) {
      console.error(err);
      msg.className = "form-msg error";
      msg.textContent = "Something went wrong saving your inquiry. Please try again or call us directly.";
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Send Inquiry";
    }
  });
}

/* ---------- Utility ---------- */
function isValidPhone(value) {
  return /^09\d{2}-\d{3}-\d{3}$/.test(value);
}

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

