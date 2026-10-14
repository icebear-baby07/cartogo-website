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
  renderAbout();
  renderFaq();
  renderContact();
  renderFooter();
  populateCarSelect();
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
  const googleButton = document.getElementById("googleOrderButton");
  const authStatus = document.getElementById("bookingAuthStatus");
  const submitButton = form.querySelector("[type=submit]");
  const draftKey = "cartogo.bookingDraft";
  const signInPendingKey = "cartogo.customerGoogleSignInPending";
  const authToast = document.getElementById("authToast");
  let currentUser = null;

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
        if (input && typeof value === "string") input.value = value;
      }
    } catch {
      sessionStorage.removeItem(draftKey);
    }
  };

  const saveDraft = () => {
    const draft = {};
    form.querySelectorAll("input, select, textarea").forEach(input => {
      if (input.id) draft[input.id] = input.value;
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
      pickupDate: document.getElementById("bookingPickup").value,
      returnDate: document.getElementById("bookingReturn").value,
      location: document.getElementById("bookingLocation").value,
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
    if (new Date(inquiry.returnDate) < new Date(inquiry.pickupDate)) {
      msg.className = "form-msg error";
      msg.textContent = "Return date can't be earlier than the pickup date.";
      return;
    }
    if (!hasVerifiedGoogleAccount(currentUser)) {
      msg.className = "form-msg error";
      msg.textContent = "Sign in with Google before sending your inquiry.";
      googleButton.focus();
      return;
    }
    submitButton.disabled = true;
    submitButton.textContent = "Sending…";
    try {
      inquiry.email = currentUser.email;
      await persistInquiry(inquiry, {
        userId: currentUser.id,
        verificationMethod: "google_oauth",
        status: "confirmed"
      });
    } catch (err) {
      console.error(err);
      msg.className = "form-msg error";
      msg.textContent = `Could not submit your inquiry: ${err.message || "Please try again."}`;
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Send Inquiry";
    }
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

