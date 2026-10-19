/* ===========================================================================
   carTOGO.mnl — ADMIN PANEL LOGIC (js/admin.js)
   Everything here reads/writes through DB (js/data.js). Changes made here
   are picked up by index.html the next time it loads, because both pages
   read from the same storage.

   SECURITY NOTE: the password gate below is a convenience lock so a casual
   visitor doesn't stumble into edit mode — it is NOT real authentication
   (the password lives in plain text in this browser's storage). Once you
   wire up a real backend (see README.md), replace this with actual login.
   ========================================================================== */

let SETTINGS = {};
let LABELS = {};
let UNITS = [];
let INQUIRIES = [];
let CHAT_SESSIONS = [];
let SELECTED_INQUIRY = null;
let CURRENT_ADMIN_EMAIL = "";
let UNIT_APPROVAL_CHALLENGE_ID = "";
let UNIT_APPROVAL_RESOLVE = null;
let UNIT_APPROVAL_RETURN_FOCUS = null;
let UNIT_APPROVAL_REQUEST_PENDING = false;
let UNIT_APPROVAL_SUBMITTING = false;
const ADMIN_SIGN_IN_PENDING_KEY = "cartogo.adminGoogleSignInPending";

document.addEventListener("DOMContentLoaded", initAdmin);

async function initAdmin() {
  bindLogin();
  if (!window.CARTOGO_CONFIG?.supabaseUrl || !window.CARTOGO_CONFIG?.supabaseAnonKey) {
    showLoginError("Supabase configuration is missing. Start the site with Cartogo/start_site.cmd after setting SUPABASE_URL and SUPABASE_ANON_KEY in main/cartogo-website/.env.");
    document.getElementById("adminGoogleSignIn").disabled = true;
    return;
  }

  SETTINGS = await DB.getSettings();
  const { data, error } = await supa.auth.getSession();
  if (error) {
    showLoginError(`Could not check sign-in status: ${error.message}`);
    return;
  }
  if (data.session) {
    CURRENT_ADMIN_EMAIL = String(data.session.user?.email || "").toLowerCase();
    await enterAdmin();
    if (document.getElementById("adminShell").classList.contains("visible")
      && sessionStorage.getItem(ADMIN_SIGN_IN_PENDING_KEY) === "true") {
      sessionStorage.removeItem(ADMIN_SIGN_IN_PENDING_KEY);
      toast("Signed in successfully.");
    }
  } else {
    sessionStorage.removeItem(ADMIN_SIGN_IN_PENDING_KEY);
  }
}

function showLoginError(message) {
  const errorBox = document.getElementById("loginError");
  errorBox.textContent = message;
  errorBox.style.display = "block";
}

/* ---------- Login ---------- */
function bindLogin() {
  const errorBox = document.getElementById("loginError");
  document.getElementById("adminGoogleSignIn").addEventListener("click", async event => {
    event.currentTarget.disabled = true;
    errorBox.textContent = "";
    errorBox.style.display = "none";
    try {
      sessionStorage.setItem(ADMIN_SIGN_IN_PENDING_KEY, "true");
      const redirectTo = new URL(window.location.pathname, window.location.origin);
      const { error } = await supa.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: redirectTo.href }
      });
      if (error) throw error;
    } catch (error) {
      sessionStorage.removeItem(ADMIN_SIGN_IN_PENDING_KEY);
      showLoginError(`Google sign-in failed: ${error.message}`);
      event.currentTarget.disabled = false;
    }
  });

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await supa.auth.signOut();
    document.getElementById("adminShell").classList.remove("visible");
    document.getElementById("loginScreen").style.display = "flex";
  });
}

async function enterAdmin() {
  const errorBox = document.getElementById("loginError");
  try {
    if (!await DB.isAdmin()) {
      await supa.auth.signOut();
      throw new Error("This Google account is not authorized to access the admin panel.");
    }
    SETTINGS.adminEmails = await DB.getAdminEmails();
    await loadAll();
    document.getElementById("loginScreen").style.display = "none";
    document.getElementById("adminShell").classList.add("visible");
    bindTabs();
    renderFleetTab();
    renderLabelsTab();
    await renderInquiriesTab();
    try {
      await renderChatMonitor();
    } catch (error) {
      document.getElementById("chatSessionCount").textContent = "Unavailable";
      document.getElementById("chatMetrics").replaceChildren();
      document.getElementById("chatSessionsTableBody").innerHTML = `<tr><td colspan="6"><div class="empty-state">Chat monitor unavailable: ${text(error.message)}</div></td></tr>`;
    }
    renderSettingsTab();
  } catch (error) {
    document.getElementById("adminShell").classList.remove("visible");
    document.getElementById("loginScreen").style.display = "flex";
    errorBox.textContent = `Admin access unavailable: ${error.message}`;
    errorBox.style.display = "block";
  }
}

async function loadAll() {
  SETTINGS = await DB.getSettings();
  LABELS = await DB.getLabels();
  UNITS = await DB.getUnits();
  INQUIRIES = await DB.getInquiries();
}

/* ---------- Tabs ---------- */
function bindTabs() {
  document.querySelectorAll(".admin-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".admin-tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".admin-panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(btn.dataset.tab).classList.add("active");
    });
  });
}

function toast(message) {
  const el = document.getElementById("adminToast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2600);
}

/* ==========================================================================
  FLEET TAB — add / edit / delete units and their rates
   ========================================================================== */
function renderFleetTab() {
  const list = document.getElementById("fleetList");
  if (UNITS.length === 0) {
    list.innerHTML = `<div class="empty-state">No units yet. Add your first one below.</div>`;
    return;
  }
  list.innerHTML = UNITS.map(unit => `
    <article class="fleet-item" data-id="${attr(unit.id)}">
      <div class="fleet-editor">
        <div class="fleet-fields">
          <label class="fleet-field">Brand<input type="text" class="f-brand" value="${attr(unit.brand)}" maxlength="160" required></label>
          <label class="fleet-field">Model<input type="text" class="f-model" value="${attr(unit.model)}" maxlength="160" required></label>
          <label class="fleet-field">Display name<input type="text" class="f-display-name" value="${attr(unit.display_name)}" maxlength="160" required></label>
          <label class="fleet-field">Capacity<input type="number" class="f-capacity" value="${unit.capacity}" min="1" step="1" required></label>
          <label class="fleet-field">IN / 12 hr (Metro Manila)<input type="number" class="f-in12-rate" value="${unit.in12_rate}" min="0" step="0.01" required></label>
          <label class="fleet-field">IN / 24 hr (Metro Manila)<input type="number" class="f-in24-rate" value="${unit.in24_rate}" min="0" step="0.01" required></label>
          <label class="fleet-field">OUT / 12 hr (neighboring areas)<input type="number" class="f-out12-rate" value="${unit.out12_rate}" min="0" step="0.01" required></label>
          <label class="fleet-field">OUT / 24 hr (neighboring areas)<input type="number" class="f-out24-rate" value="${unit.out24_rate}" min="0" step="0.01" required></label>
          <label class="fleet-field">Luzon rate<input type="number" class="f-luzon-rate" value="${unit.luzon_rate}" min="0" step="0.01" required></label>
          <label class="fleet-field">Status<select class="f-status">
            ${["Available", "Rented", "Maintenance", "Inactive"].map(status => `<option ${unit.status === status ? "selected" : ""}>${status}</option>`).join("")}
          </select></label>
          <label class="fleet-field">Features<input type="text" class="f-features" value="${attr((unit.features || []).join(", "))}" placeholder="Comma-separated"></label>
        </div>
        <div class="fleet-actions">
          <button class="btn btn-dark btn-sm save-unit" type="button"><i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> Save changes</button>
          <button class="icon-btn danger delete-unit" type="button" title="Delete unit" aria-label="Delete ${attr(unit.display_name)}"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button>
        </div>
      </div>
    </article>
  `).join("");

  list.querySelectorAll(".fleet-field input, .fleet-field select").forEach(control => {
    const field = control.closest(".fleet-field");
    control.dataset.originalValue = control.value;
    const updateDirtyState = () => {
      field.classList.toggle("is-dirty", control.value !== control.dataset.originalValue);
    };
    control.addEventListener("input", updateDirtyState);
    control.addEventListener("change", updateDirtyState);
  });

  list.querySelectorAll(".save-unit").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const row = e.currentTarget.closest(".fleet-item");
      const unit = {
        id: Number(row.dataset.id),
        brand: row.querySelector(".f-brand").value.trim(),
        model: row.querySelector(".f-model").value.trim(),
        display_name: row.querySelector(".f-display-name").value.trim(),
        capacity: Number(row.querySelector(".f-capacity").value),
        in12_rate: Number(row.querySelector(".f-in12-rate").value),
        in24_rate: Number(row.querySelector(".f-in24-rate").value),
        out12_rate: Number(row.querySelector(".f-out12-rate").value),
        out24_rate: Number(row.querySelector(".f-out24-rate").value),
        luzon_rate: Number(row.querySelector(".f-luzon-rate").value),
        status: row.querySelector(".f-status").value,
        features: row.querySelector(".f-features").value.split(",").map(feature => feature.trim()).filter(Boolean)
      };
      try {
        await requestAndApproveUnitChange("update", unit);
        UNITS = await DB.getUnits();
        renderFleetTab();
        toast(`Saved changes to ${unit.display_name}.`);
      } catch (error) {
        toast(error.message);
      }
    });
  });

  list.querySelectorAll(".delete-unit").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const row = e.currentTarget.closest(".fleet-item");
      const unit = UNITS.find(item => item.id === Number(row.dataset.id));
      if (!confirm(`Delete "${unit.display_name}" from the unit data? This can't be undone.`)) return;
      try {
        await requestAndApproveUnitChange("delete", { id: unit.id, display_name: unit.display_name });
        UNITS = await DB.getUnits();
        renderFleetTab();
        toast(`Deleted ${unit.display_name}.`);
      } catch (error) {
        toast(error.message);
      }
    });
  });
}

async function requestAndApproveUnitChange(action, unit) {
  const operation = action === "add" ? "Add" : action === "update" ? "Update" : "Delete";
  showUnitApprovalLoading(operation, unit.display_name);
  try {
    const { challengeId } = await DB.requestUnitChange(action, unit);
    const approved = await openUnitApprovalDialog(challengeId, operation, unit.display_name);
    if (!approved) throw new Error("Approval cancelled. The code will expire in five minutes.");
  } catch (error) {
    UNIT_APPROVAL_REQUEST_PENDING = false;
    closeUnitApprovalDialog(false);
    throw error;
  }
}

function showUnitApprovalLoading(operation, unitName) {
  const modal = document.getElementById("unitApprovalModal");
  const closeButtons = [document.getElementById("closeUnitApproval"), document.getElementById("cancelUnitApproval")];
  document.getElementById("unitApprovalTitle").textContent = `${operation} unit`;
  document.getElementById("unitApprovalDescription").textContent = `Requesting an approval code for ${unitName}. It will be sent to ${CURRENT_ADMIN_EMAIL}.`;
  document.getElementById("unitApprovalLoadingText").textContent = "Sending approval code...";
  document.getElementById("unitApprovalLoading").hidden = false;
  document.getElementById("unitApprovalForm").hidden = true;
  document.getElementById("unitApprovalError").hidden = true;
  document.getElementById("unitApprovalError").textContent = "";
  UNIT_APPROVAL_REQUEST_PENDING = true;
  UNIT_APPROVAL_SUBMITTING = false;
  UNIT_APPROVAL_RETURN_FOCUS = document.activeElement;
  closeButtons.forEach(button => { button.disabled = true; });
  modal.hidden = false;
  document.getElementById("unitApprovalTitle").focus();
}

function openUnitApprovalDialog(challengeId, operation, unitName) {
  const modal = document.getElementById("unitApprovalModal");
  const codeInput = document.getElementById("unitApprovalCode");
  const closeButtons = [document.getElementById("closeUnitApproval"), document.getElementById("cancelUnitApproval")];
  document.getElementById("unitApprovalTitle").textContent = `${operation} ${unitName}`;
  document.getElementById("unitApprovalDescription").textContent = `Enter the six-digit code sent to ${CURRENT_ADMIN_EMAIL}. The code expires in five minutes.`;
  document.getElementById("unitApprovalLoading").hidden = true;
  document.getElementById("unitApprovalForm").hidden = false;
  document.getElementById("unitApprovalError").hidden = true;
  document.getElementById("unitApprovalError").textContent = "";
  codeInput.value = "";
  UNIT_APPROVAL_CHALLENGE_ID = challengeId;
  UNIT_APPROVAL_REQUEST_PENDING = false;
  UNIT_APPROVAL_SUBMITTING = false;
  closeButtons.forEach(button => { button.disabled = false; });
  UNIT_APPROVAL_RETURN_FOCUS = document.activeElement;
  modal.hidden = false;
  codeInput.focus();
  return new Promise(resolve => {
    UNIT_APPROVAL_RESOLVE = resolve;
  });
}

function closeUnitApprovalDialog(approved) {
  const modal = document.getElementById("unitApprovalModal");
  if (modal.hidden || ((UNIT_APPROVAL_REQUEST_PENDING || UNIT_APPROVAL_SUBMITTING) && !approved)) return;
  modal.hidden = true;
  UNIT_APPROVAL_CHALLENGE_ID = "";
  UNIT_APPROVAL_REQUEST_PENDING = false;
  UNIT_APPROVAL_SUBMITTING = false;
  const resolve = UNIT_APPROVAL_RESOLVE;
  UNIT_APPROVAL_RESOLVE = null;
  if (UNIT_APPROVAL_RETURN_FOCUS?.isConnected) UNIT_APPROVAL_RETURN_FOCUS.focus();
  UNIT_APPROVAL_RETURN_FOCUS = null;
  resolve?.(approved);
}

function bindUnitApprovalDialog() {
  const modal = document.getElementById("unitApprovalModal");
  const form = document.getElementById("unitApprovalForm");
  const codeInput = document.getElementById("unitApprovalCode");
  const submitButton = document.getElementById("submitUnitApproval");
  const closeButtons = [document.getElementById("closeUnitApproval"), document.getElementById("cancelUnitApproval")];

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (UNIT_APPROVAL_SUBMITTING) return;
    const code = codeInput.value.trim();
    const error = document.getElementById("unitApprovalError");
    if (!/^\d{6}$/.test(code)) {
      error.textContent = "Enter the six-digit code from your email.";
      error.hidden = false;
      codeInput.focus();
      return;
    }

    UNIT_APPROVAL_SUBMITTING = true;
    submitButton.disabled = true;
    submitButton.textContent = "Verifying...";
    closeButtons.forEach(button => { button.disabled = true; });
    error.hidden = true;
    try {
      await DB.approveUnitChange(UNIT_APPROVAL_CHALLENGE_ID, code);
      closeUnitApprovalDialog(true);
    } catch (approvalError) {
      error.textContent = approvalError.message;
      error.hidden = false;
      codeInput.select();
    } finally {
      UNIT_APPROVAL_SUBMITTING = false;
      submitButton.disabled = false;
      submitButton.textContent = "Approve change";
      closeButtons.forEach(button => { button.disabled = false; });
    }
  });

  document.getElementById("closeUnitApproval").addEventListener("click", () => closeUnitApprovalDialog(false));
  document.getElementById("cancelUnitApproval").addEventListener("click", () => closeUnitApprovalDialog(false));
  modal.addEventListener("click", event => {
    if (event.target === modal) closeUnitApprovalDialog(false);
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !modal.hidden) closeUnitApprovalDialog(false);
  });
}

function bindAddCarForm() {
  const form = document.getElementById("addCarForm");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const unit = {
      brand: document.getElementById("newCarBrand").value.trim(),
      model: document.getElementById("newCarModel").value.trim(),
      display_name: document.getElementById("newCarDisplayName").value.trim(),
      capacity: Number(document.getElementById("newCarCapacity").value),
      in12_rate: Number(document.getElementById("newCarIn12Rate").value),
      in24_rate: Number(document.getElementById("newCarIn24Rate").value),
      out12_rate: Number(document.getElementById("newCarOut12Rate").value),
      out24_rate: Number(document.getElementById("newCarOut24Rate").value),
      luzon_rate: Number(document.getElementById("newCarLuzonRate").value),
      status: document.getElementById("newCarStatus").value,
      features: document.getElementById("newCarFeatures").value.split(",").map(feature => feature.trim()).filter(Boolean)
    };
    try {
      await requestAndApproveUnitChange("add", unit);
      UNITS = await DB.getUnits();
      renderFleetTab();
      form.reset();
      toast(`Added ${unit.display_name} to the unit data.`);
    } catch (error) {
      toast(error.message);
    }
  });
}

/* ==========================================================================
   LABELS TAB — every editable piece of site copy
   ========================================================================== */
function renderLabelsTab() {
  const wrap = document.getElementById("labelsForm");
  const editableTrustItems = LABELS.trustStrip.filter(item => !isAutomaticFleetStat(item));

  wrap.innerHTML = `
    <div class="label-group">
      <h3>Hero</h3>
      <div class="label-field"><label>Headline (HTML ok, e.g. &lt;em&gt;)</label><input id="lblHeroTitle" value="${attr(LABELS.hero.title)}"></div>
      <div class="label-field"><label>Subheadline</label><textarea id="lblHeroSubtitle" rows="2">${text(LABELS.hero.subtitle)}</textarea></div>
    </div>

    <div class="label-group">
      <h3>Trust strip</h3>
      <div id="trustRepeat">${editableTrustItems.map(item => `
        <div class="repeat-item">
          <div class="label-field"><label>Value</label><input class="trust-value" value="${attr(item.value)}"></div>
          <div class="label-field"><label>Label</label><input class="trust-label" value="${attr(item.label)}"></div>
        </div>
      `).join("")}</div>
    </div>

    <div class="label-group">
      <h3>About section</h3>
      <div class="label-field"><label>Title</label><input id="lblAboutTitle" value="${attr(LABELS.about.title)}"></div>
      <div class="label-field"><label>Body</label><textarea id="lblAboutBody" rows="3">${text(LABELS.about.body)}</textarea></div>
    </div>

    <div class="label-group">
      <h3>Contact info</h3>
      <div class="label-field"><label>Phone</label><input id="lblPhone" value="${attr(LABELS.contact.phone)}"></div>
      <div class="label-field"><label>Email</label><input id="lblEmail" value="${attr(LABELS.contact.email)}"></div>
      <div class="label-field"><label>Hours</label><input id="lblHours" value="${attr(LABELS.contact.hours)}"></div>
    </div>

    <div class="label-group">
      <h3>Pickup points</h3>
      <p style="font-size:0.82rem; color:var(--slate); margin-top:-0.5rem; margin-bottom:0.9rem;">
        Format each as "Name — Address", e.g. <em>Downtown Hub — 88 Fairview Ave, Quezon City</em>.
        These also fill the pickup-point dropdown on the booking form automatically.
      </p>
      <div id="locationsRepeat">${LABELS.contact.locations.map((loc) => `
        <div class="repeat-item">
          <button type="button" class="icon-btn danger remove-repeat" title="Remove this pickup point"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
          <div class="label-field"><label>Pickup point</label><input class="loc-item" value="${attr(loc)}"></div>
        </div>
      `).join("")}</div>
      <button type="button" class="btn btn-ghost btn-sm" id="addLocationBtn">+ Add pickup point</button>
    </div>

    <div class="label-group">
      <h3>FAQ</h3>
      <div id="faqRepeat">${LABELS.faq.map(item => `
        <div class="repeat-item">
          <button type="button" class="icon-btn danger remove-repeat"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
          <div class="label-field"><label>Question</label><input class="faq-q-input" value="${attr(item.q)}"></div>
          <div class="label-field"><label>Answer</label><textarea class="faq-a-input" rows="2">${text(item.a)}</textarea></div>
        </div>
      `).join("")}</div>
      <button type="button" class="btn btn-ghost btn-sm" id="addFaqBtn">+ Add FAQ item</button>
    </div>

    <div class="label-group">
      <h3>How it works (4 steps)</h3>
      <div id="howRepeat">${LABELS.howItWorks.map((step) => `
        <div class="repeat-item">
          <div class="label-field"><label>Step title</label><input class="how-title" value="${attr(step.title)}"></div>
          <div class="label-field"><label>Step description</label><textarea class="how-desc" rows="2">${text(step.description)}</textarea></div>
        </div>
      `).join("")}</div>
      <p style="font-size:0.8rem; color:var(--slate-light); margin-top:-0.4rem;">These are numbered 01–04 automatically on the site, in the order shown here.</p>
    </div>

    <div class="label-group">
      <h3>Why choose us</h3>
      <div id="whyRepeat">${LABELS.whyChooseUs.map((item) => `
        <div class="repeat-item">
          <button type="button" class="icon-btn danger remove-repeat" title="Remove this card"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
          <div class="label-field"><label>Professional icon (car, clipboard, card, location, phone, key, shield)</label><input class="why-icon" value="${attr(item.icon)}" style="max-width:80px;"></div>
          <div class="label-field"><label>Title</label><input class="why-title" value="${attr(item.title)}"></div>
          <div class="label-field"><label>Description</label><textarea class="why-desc" rows="2">${text(item.description)}</textarea></div>
        </div>
      `).join("")}</div>
      <button type="button" class="btn btn-ghost btn-sm" id="addWhyBtn">+ Add card</button>
    </div>

    <div class="label-group">
      <h3>Testimonials</h3>
      <div id="testiRepeat">${LABELS.testimonials.map((t) => `
        <div class="repeat-item">
          <button type="button" class="icon-btn danger remove-repeat" title="Remove this testimonial"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
          <div class="label-field"><label>Quote</label><textarea class="testi-quote" rows="2">${text(t.quote)}</textarea></div>
          <div class="label-field"><label>Name / initials</label><input class="testi-name" value="${attr(t.name)}"></div>
          <div class="label-field"><label>Detail (e.g. "Rented an SUV, 4 days")</label><input class="testi-detail" value="${attr(t.detail)}"></div>
        </div>
      `).join("")}</div>
      <button type="button" class="btn btn-ghost btn-sm" id="addTestiBtn">+ Add testimonial</button>
    </div>

    <button type="button" class="btn btn-primary" id="saveLabelsBtn">Save all label changes</button>
  `;

  document.getElementById("addFaqBtn").addEventListener("click", () => {
    const repeat = document.getElementById("faqRepeat");
    const div = document.createElement("div");
    div.className = "repeat-item";
    div.innerHTML = `
      <button type="button" class="icon-btn danger remove-repeat"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
      <div class="label-field"><label>Question</label><input class="faq-q-input" value=""></div>
      <div class="label-field"><label>Answer</label><textarea class="faq-a-input" rows="2"></textarea></div>
    `;
    repeat.appendChild(div);
    bindRemoveButtons();
  });

  document.getElementById("addLocationBtn").addEventListener("click", () => {
    const repeat = document.getElementById("locationsRepeat");
    const div = document.createElement("div");
    div.className = "repeat-item";
    div.innerHTML = `
      <button type="button" class="icon-btn danger remove-repeat" title="Remove this pickup point"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
      <div class="label-field"><label>Pickup point</label><input class="loc-item" value=""></div>
    `;
    repeat.appendChild(div);
    bindRemoveButtons();
  });

  document.getElementById("addWhyBtn").addEventListener("click", () => {
    const repeat = document.getElementById("whyRepeat");
    const div = document.createElement("div");
    div.className = "repeat-item";
    div.innerHTML = `
      <button type="button" class="icon-btn danger remove-repeat" title="Remove this card"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
      <div class="label-field"><label>Professional icon (car, clipboard, card, location, phone, key, shield)</label><input class="why-icon" value="" style="max-width:80px;"></div>
      <div class="label-field"><label>Title</label><input class="why-title" value=""></div>
      <div class="label-field"><label>Description</label><textarea class="why-desc" rows="2"></textarea></div>
    `;
    repeat.appendChild(div);
    bindRemoveButtons();
  });

  document.getElementById("addTestiBtn").addEventListener("click", () => {
    const repeat = document.getElementById("testiRepeat");
    const div = document.createElement("div");
    div.className = "repeat-item";
    div.innerHTML = `
      <button type="button" class="icon-btn danger remove-repeat" title="Remove this testimonial"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
      <div class="label-field"><label>Quote</label><textarea class="testi-quote" rows="2"></textarea></div>
      <div class="label-field"><label>Name / initials</label><input class="testi-name" value=""></div>
      <div class="label-field"><label>Detail (e.g. "Rented an SUV, 4 days")</label><input class="testi-detail" value=""></div>
    `;
    repeat.appendChild(div);
    bindRemoveButtons();
  });

  bindRemoveButtons();

  document.getElementById("saveLabelsBtn").addEventListener("click", async () => {
    const locations = [...document.querySelectorAll(".loc-item")]
      .map(i => i.value.trim())
      .filter(Boolean);

    if (locations.length === 0) {
      toast("Keep at least one company location for the contact section.");
      return;
    }

    const editedTrustItems = [...document.querySelectorAll("#trustRepeat .repeat-item")].map(item => ({
      value: item.querySelector(".trust-value").value,
      label: item.querySelector(".trust-label").value
    }));
    let editedTrustIndex = 0;
    const newLabels = {
      ...LABELS,
      hero: {
        title: document.getElementById("lblHeroTitle").value,
        subtitle: document.getElementById("lblHeroSubtitle").value
      },
      trustStrip: LABELS.trustStrip.map(item => isAutomaticFleetStat(item)
        ? item
        : editedTrustItems[editedTrustIndex++]),
      about: {
        title: document.getElementById("lblAboutTitle").value,
        body: document.getElementById("lblAboutBody").value
      },
      contact: {
        phone: document.getElementById("lblPhone").value,
        email: document.getElementById("lblEmail").value,
        hours: document.getElementById("lblHours").value,
        locations
      },
      faq: [...document.querySelectorAll("#faqRepeat .repeat-item")].map(item => ({
        q: item.querySelector(".faq-q-input").value,
        a: item.querySelector(".faq-a-input").value
      })),
      howItWorks: [...document.querySelectorAll("#howRepeat .repeat-item")].map(item => ({
        title: item.querySelector(".how-title").value,
        description: item.querySelector(".how-desc").value
      })),
      whyChooseUs: [...document.querySelectorAll("#whyRepeat .repeat-item")].map(item => ({
        icon: item.querySelector(".why-icon").value,
        title: item.querySelector(".why-title").value,
        description: item.querySelector(".why-desc").value
      })),
      testimonials: [...document.querySelectorAll("#testiRepeat .repeat-item")].map(item => ({
        quote: item.querySelector(".testi-quote").value,
        name: item.querySelector(".testi-name").value,
        detail: item.querySelector(".testi-detail").value
      }))
    };
    await DB.saveLabels(newLabels);
    LABELS = await DB.getLabels();
    toast("Labels saved. Refresh the main site to see changes.");
  });
}

function bindRemoveButtons() {
  document.querySelectorAll(".remove-repeat").forEach(btn => {
    btn.onclick = () => btn.closest(".repeat-item").remove();
  });
}

/* ==========================================================================
   INQUIRIES TAB — the client/booking data collected from the public site
   ========================================================================== */
async function renderInquiriesTab() {
  INQUIRIES = await DB.getInquiries();
  const tbody = document.getElementById("inquiriesTableBody");

  if (INQUIRIES.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state">No inquiries yet — they'll appear here as soon as someone submits the booking form on the main site.</div></td></tr>`;
    document.getElementById("inquiryCount").textContent = "0 inquiries";
    return;
  }

  document.getElementById("inquiryCount").textContent = `${INQUIRIES.length} inquir${INQUIRIES.length === 1 ? "y" : "ies"}`;

  tbody.innerHTML = INQUIRIES.map(inq => `
    <tr data-id="${inq.id}">
<td>${inq.created_at ? new Date(inq.created_at).toLocaleDateString() : "N/A"}</td>
<td>
    <strong>${text(inq.name)}</strong><br>
  <span style="font-size:0.85rem; color:var(--slate-light);">${text(inq.email)} - ${text(inq.phone)}${inq.secondary_phone ? ` - ${text(inq.secondary_phone)}` : ""}</span>
</td>
<td><strong>${text(inq.car_name || "N/A")}</strong></td>
<td>${text(inq.pickup_date || "N/A")} ${text(inq.pickup_time || "")} &rarr; ${text(inq.return_date || "N/A")}</td>
<td>${text(inq.location || "-")}</td>
      <td>
        <select class="status-select status-${inq.status}">
          ${[["pending_review", "Pending review"], ["contacted", "Contacted"], ["confirmed", "Confirmed"], ["rejected", "Rejected"]].map(([value, label]) =>
            `<option value="${value}" ${inq.status === value ? "selected" : ""}>${label}</option>`
          ).join("")}
        </select>
      </td>
      <td class="row-actions">
        <button class="icon-btn view-inquiry" title="View full inquiry" aria-label="View full inquiry"><i class="fa-solid fa-eye" aria-hidden="true"></i></button>
        <button class="icon-btn danger delete-inquiry" title="Delete"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button>
      </td>
    </tr>
  `).join("");

  tbody.querySelectorAll(".status-select").forEach(sel => {
    sel.addEventListener("change", async (e) => {
      const id = e.target.closest("tr").dataset.id;
      try {
        await DB.updateInquiry(id, { status: e.target.value });
        e.target.className = `status-select status-${e.target.value}`;
        toast("Inquiry status updated.");
      } catch (error) {
        toast(`Could not update inquiry: ${error.message}`);
        await renderInquiriesTab();
      }
    });
  });

  tbody.querySelectorAll(".delete-inquiry").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const id = Number(e.target.closest("tr").dataset.id);
      if (!confirm("Delete this inquiry permanently?")) return;
      await DB.deleteInquiry(id);
      await renderInquiriesTab();
      toast("Inquiry deleted.");
    });
  });

  tbody.querySelectorAll(".view-inquiry").forEach(btn => {
    btn.addEventListener("click", (e) => showInquiryDetails(e.target.closest("tr").dataset.id));
  });

}

function exportInquiryCsv(inquiry) {
  const row = [
    ["Submitted", "Name", "Email", "Phone", "Secondary phone", "Unit", "Unit ID", "Capacity", "Pickup date", "Pickup time", "Return date", "Target location", "Target latitude", "Target longitude", "Nearest pickup", "Distance km", "Rate region", "Rate period hours", "Estimated hours", "Rental days", "Rate per period", "Discount percent", "Discount amount", "Quoted rate", "Status", "Notes"],
    [
      inquiry.created_at || inquiry.submittedAt || "",
      inquiry.name || "",
      inquiry.email || "",
      inquiry.phone || "",
      inquiry.secondary_phone || "",
      inquiry.car_name || inquiry.carName || "",
      inquiry.car_id || inquiry.carId || "",
      inquiry.capacity ?? "",
      inquiry.pickup_date || inquiry.pickupDate || "",
      inquiry.pickup_time || inquiry.pickupTime || "",
      inquiry.return_date || inquiry.returnDate || "",
      inquiry.location || "",
      inquiry.target_latitude ?? "",
      inquiry.target_longitude ?? "",
      inquiry.nearest_pickup_name || "",
      inquiry.nearest_pickup_distance_km ?? "",
      inquiry.rate_region || "",
      inquiry.rental_period_hours ?? "",
      inquiry.estimated_rental_hours ?? "",
      inquiry.rental_days ?? "",
      inquiry.rate_per_period ?? "",
      inquiry.discount_percent ?? "",
      inquiry.discount_amount ?? "",
      inquiry.quoted_rate ?? "",
      inquiry.status || "New",
      inquiry.notes || ""
    ]
  ];
  const csv = row.map(values => values.map(value => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const currentDate = new Date().toISOString().slice(0, 10);
  link.download = `cartogo-inquiry-${inquiry.id || "record"}-${currentDate}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function showInquiryDetails(id) {
  const inquiry = INQUIRIES.find(item => String(item.id) === String(id));
  if (!inquiry) return;
  SELECTED_INQUIRY = inquiry;
  const submitted = inquiry.created_at || inquiry.submittedAt;
  document.getElementById("inquiryDetailTitle").textContent = inquiry.name || "Inquiry details";
  document.getElementById("inquiryDetailMeta").textContent = submitted ? `Submitted ${formatDate(submitted)}` : "Submission time unavailable";
  document.getElementById("inquiryDetails").innerHTML = `
    <div class="inquiry-detail-grid">
      <div><dt>Full name</dt><dd>${text(inquiry.name)}</dd></div>
      <div><dt>Status</dt><dd><span class="status-pill status-${text(inquiry.status || "New")}">${text(inquiry.status || "New")}</span></dd></div>
      <div><dt>Email</dt><dd>${text(inquiry.email || "—")}</dd></div>
      <div><dt>Phone number</dt><dd>${text(inquiry.phone || "—")}</dd></div>
      <div><dt>Secondary phone</dt><dd>${text(inquiry.secondary_phone || "—")}</dd></div>
      <div><dt>Verified by</dt><dd>${text(inquiry.verification_method || "—")}</dd></div>
      <div><dt>Verified at</dt><dd>${inquiry.verified_at ? text(formatDate(inquiry.verified_at)) : "—"}</dd></div>
      <div><dt>Unit</dt><dd>${text(inquiry.car_name || inquiry.carName || "—")}</dd></div>
      <div><dt>Capacity</dt><dd>${text(inquiry.capacity ?? "—")}</dd></div>
      <div><dt>Pickup date</dt><dd>${text(inquiry.pickup_date || inquiry.pickupDate || "—")}</dd></div>
      <div><dt>Pickup time</dt><dd>${text(inquiry.pickup_time || inquiry.pickupTime || "—")}</dd></div>
      <div><dt>Return date</dt><dd>${text(inquiry.return_date || inquiry.returnDate || "—")}</dd></div>
      <div><dt>Target location</dt><dd>${text(inquiry.location || "—")}</dd></div>
      <div><dt>Target coordinates</dt><dd>${text(inquiry.target_latitude ?? "—")}, ${text(inquiry.target_longitude ?? "—")}</dd></div>
      <div><dt>Nearest pickup</dt><dd>${text(inquiry.nearest_pickup_name || "—")} · ${text(inquiry.nearest_pickup_distance_km ?? "—")} km</dd></div>
      <div><dt>Quoted rate</dt><dd>${text(inquiry.rate_region || "—")} · ${text(inquiry.rental_days ?? "—")} days · ${text(inquiry.rental_period_hours ?? "—")} hrs · ${text(inquiry.quoted_rate ?? "—")}</dd></div>
      <div><dt>Promo discount</dt><dd>${text(inquiry.discount_percent ?? 0)}% · ${text(inquiry.discount_amount ?? 0)}</dd></div>
      <div class="inquiry-detail-wide"><dt>Notes</dt><dd class="preserve-lines">${text(inquiry.notes || "—")}</dd></div>
    </div>
  `;
  document.getElementById("inquiryDetailModal").hidden = false;
  document.getElementById("closeInquiryDetail").focus();
}

function bindInquiryTools() {
  document.getElementById("refreshInquiriesBtn").addEventListener("click", async () => {
    await renderInquiriesTab();
    toast("Inquiries refreshed.");
  });

  document.getElementById("exportCsvBtn").addEventListener("click", () => {
    if (INQUIRIES.length === 0) { toast("No inquiries to export yet."); return; }
    const headers = ["Submitted", "Name", "Email", "Phone", "Unit", "Capacity", "Pickup Date", "Pickup Time", "Return Date", "Location", "Rate Region", "Rental Days", "Rate Period Hours", "Discount Percent", "Discount Amount", "Quoted Rate", "Status", "Notes"];
    const rows = INQUIRIES.map(i => [
      i.submittedAt || i.created_at || "", i.name, i.email, i.phone, i.carName || i.car_name, i.capacity ?? "",
      i.pickupDate || i.pickup_date, i.pickup_time || i.pickupTime || "", i.returnDate || i.return_date, i.location || "", i.rate_region || "",
      i.rental_days ?? "", i.rental_period_hours ?? "", i.discount_percent ?? "", i.discount_amount ?? "",
      i.quoted_rate ?? "", i.status, (i.notes || "").replace(/\n/g, " ")
    ]);
    const csv = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cartogo-inquiries-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

/* ========================================================================== 
   CHAT MONITOR TAB — session metrics and read-only transcripts
   ========================================================================== */
async function renderChatMonitor() {
  CHAT_SESSIONS = await DB.getChatSessions();
  const count = CHAT_SESSIONS.length;
  const messageCount = CHAT_SESSIONS.reduce((total, session) => total + session.messages.length, 0);
  const userMessageCount = CHAT_SESSIONS.reduce((total, session) => total + session.messages.filter(message => message.role === "user").length, 0);
  document.getElementById("chatSessionCount").textContent = `${count} session${count === 1 ? "" : "s"}`;
  document.getElementById("chatMetrics").innerHTML = `
    <div class="chat-metric"><strong>${count}</strong><span>Total sessions</span></div>
    <div class="chat-metric"><strong>${messageCount}</strong><span>Total messages</span></div>
    <div class="chat-metric"><strong>${userMessageCount}</strong><span>Visitor messages</span></div>
  `;

  const tbody = document.getElementById("chatSessionsTableBody");
  if (count === 0) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state">No chatbot sessions yet.</div></td></tr>`;
    return;
  }
  tbody.innerHTML = CHAT_SESSIONS.map(session => `
    <tr data-id="${attr(session.id)}">
      <td>${formatDate(session.startedAt)}</td>
      <td>${text(session.username || "Guest")}</td>
      <td><code>${attr(session.id)}</code></td>
      <td>${session.messages.length}</td>
      <td>${formatDate(session.lastMessageAt || session.startedAt)}</td>
      <td class="row-actions">
        <button class="icon-btn view-chat" title="View transcript" aria-label="View transcript"><i class="fa-solid fa-eye" aria-hidden="true"></i></button>
        <button class="icon-btn danger delete-chat" title="Delete session" aria-label="Delete session"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button>
      </td>
    </tr>
  `).join("");

  tbody.querySelectorAll(".view-chat").forEach(button => {
    button.addEventListener("click", event => showChatTranscript(event.target.closest("tr").dataset.id));
  });
  tbody.querySelectorAll(".delete-chat").forEach(button => {
    button.addEventListener("click", async event => {
      const id = event.target.closest("tr").dataset.id;
      if (!confirm("Delete this chat session permanently?")) return;
      await DB.deleteChatSession(id);
      closeChatTranscriptModal();
      await renderChatMonitor();
      toast("Chat session deleted.");
    });
  });
}

function showChatTranscript(id) {
  const session = CHAT_SESSIONS.find(item => item.id === id);
  if (!session) return;
  document.getElementById("chatTranscriptTitle").textContent = `Conversation ${session.id}`;
  document.getElementById("chatTranscriptMeta").textContent = `${session.username || "Guest"} · Started ${formatDate(session.startedAt)} · ${session.messages.length} messages`;
  document.getElementById("chatTranscript").innerHTML = session.messages.map(message => `
    <div class="chat-transcript-message ${message.role}"><strong>${message.role === "user" ? "Visitor" : "Assistant"}</strong><br>${text(message.content)}<br><small>${formatDate(message.createdAt)}</small></div>
  `).join("");
  document.getElementById("chatTranscriptModal").hidden = false;
  document.getElementById("closeChatTranscript").focus();
}

function bindChatMonitor() {
  document.getElementById("refreshChatBtn").addEventListener("click", async () => {
    await renderChatMonitor();
    toast("Chat sessions refreshed.");
  });
  document.getElementById("closeChatTranscript").addEventListener("click", () => {
    closeChatTranscriptModal();
  });
  document.getElementById("chatTranscriptModal").addEventListener("click", event => {
    if (event.target.id === "chatTranscriptModal") closeChatTranscriptModal();
  });
  document.getElementById("closeInquiryDetail").addEventListener("click", closeInquiryDetailModal);
  document.getElementById("exportSelectedInquiry").addEventListener("click", () => {
    if (SELECTED_INQUIRY) exportInquiryCsv(SELECTED_INQUIRY);
  });
  document.getElementById("inquiryDetailModal").addEventListener("click", event => {
    if (event.target.id === "inquiryDetailModal") closeInquiryDetailModal();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      closeChatTranscriptModal();
      closeInquiryDetailModal();
    }
  });
}

function closeChatTranscriptModal() {
  document.getElementById("chatTranscriptModal").hidden = true;
}

function closeInquiryDetailModal() {
  document.getElementById("inquiryDetailModal").hidden = true;
  SELECTED_INQUIRY = null;
}

function isAutomaticFleetStat(item) {
  return /^(cars? in our fleet|vehicle options)$/i.test(String(item.label).trim());
}

/* SETTINGS TAB — company info, currency, fees, admin accounts
   ========================================================================== */
function renderSettingsTab() {
  const wrap = document.getElementById("settingsForm");
  wrap.innerHTML = `
    <div class="settings-grid">
      <div class="label-field"><label for="setCompanyName">Company name</label><input id="setCompanyName" value="${attr(SETTINGS.companyName)}"></div>
      <div class="label-field"><label for="setCurrency">Currency symbol</label><input id="setCurrency" value="${attr(SETTINGS.currency)}" maxlength="3"></div>
      <div class="label-field"><label for="setDeposit">Deposit percentage (% of estimated rental total)</label><input id="setDeposit" type="number" value="${SETTINGS.depositPercent}"></div>
      <div class="label-field"><label for="setExtraDriver">Extra driver fee</label><input id="setExtraDriver" type="number" value="${SETTINGS.extraDriverFee}"></div>
      <div class="label-field"><label for="setChildSeat">Child seat fee</label><input id="setChildSeat" type="number" value="${SETTINGS.childSeatFee}"></div>
      <div class="label-field"><label for="setLateFee">Late return fee (per hour)</label><input id="setLateFee" type="number" value="${SETTINGS.lateFeePerHour}"></div>
      <div class="settings-admin-email">
        <h2>Administrator accounts</h2>
        <p class="sub">Each account must sign in with Google once before it can be added.</p>
        <ul class="admin-account-list" id="adminAccountsList"></ul>
        <div class="admin-account-add">
          <label class="label-field" for="newAdminEmail">Google account email<input id="newAdminEmail" type="email" autocomplete="email" required></label>
          <button type="button" class="btn btn-dark" id="addAdminEmailBtn"><i class="fa-solid fa-plus" aria-hidden="true"></i> Add account</button>
        </div>
      </div>
    </div>
    <div class="settings-actions"><button type="button" class="btn btn-primary" id="saveSettingsBtn">Save settings</button></div>

    <section class="danger-zone">
      <div><h2>Danger zone</h2><p>Resets local fleet, labels, and site preferences. Customer inquiries and admin authorization remain stored in Supabase.</p></div>
      <button type="button" class="btn btn-ghost btn-sm" id="resetAllBtn">Reset everything to defaults</button>
    </section>
  `;
  renderAdminAccounts();

  document.getElementById("addAdminEmailBtn").addEventListener("click", async () => {
    const input = document.getElementById("newAdminEmail");
    const email = input.value.trim().toLowerCase();
    if (!input.reportValidity()) return;
    try {
      await DB.addAdminEmail(email);
      SETTINGS.adminEmails = await DB.getAdminEmails();
      input.value = "";
      renderAdminAccounts();
      toast("Administrator account added.");
    } catch (error) {
      toast(`Could not add administrator: ${error.message}`);
    }
  });

  document.getElementById("adminAccountsList").addEventListener("click", async event => {
    const button = event.target.closest("[data-remove-admin]");
    if (!button) return;
    const email = button.dataset.removeAdmin;
    if (!confirm(`Remove ${email} from administrator accounts?`)) return;
    try {
      await DB.removeAdminEmail(email);
      SETTINGS.adminEmails = await DB.getAdminEmails();
      renderAdminAccounts();
      toast("Administrator account removed.");
    } catch (error) {
      toast(`Could not remove administrator: ${error.message}`);
    }
  });

  document.getElementById("saveSettingsBtn").addEventListener("click", async () => {
    try {
      await DB.saveSettings({
      companyName: document.getElementById("setCompanyName").value.trim(),
      currency: document.getElementById("setCurrency").value.trim() || "$",
      depositPercent: Number(document.getElementById("setDeposit").value) || 0,
      extraDriverFee: Number(document.getElementById("setExtraDriver").value) || 0,
      childSeatFee: Number(document.getElementById("setChildSeat").value) || 0,
        lateFeePerHour: Number(document.getElementById("setLateFee").value) || 0
      });
      SETTINGS = { ...SETTINGS, ...await DB.getSettings() };
      toast("Settings saved.");
    } catch (error) {
      toast(`Could not save settings: ${error.message}`);
    }
  });

  document.getElementById("resetAllBtn").addEventListener("click", async () => {
    if (!confirm("Reset local fleet, labels, and site preferences? Customer inquiries will remain in Supabase.")) return;
    await DB.resetAll();
    await loadAll();
    SETTINGS.adminEmails = await DB.getAdminEmails();
    renderFleetTab();
    renderLabelsTab();
    await renderInquiriesTab();
    await renderChatMonitor();
    renderSettingsTab();
    toast("Everything reset to defaults.");
  });
}

function renderAdminAccounts() {
  const list = document.getElementById("adminAccountsList");
  if (!list) return;
  const emails = SETTINGS.adminEmails || [];
  list.innerHTML = emails.map(email => `
    <li>
      <span>${text(email)}${email.toLowerCase() === CURRENT_ADMIN_EMAIL ? " (you)" : ""}</span>
      <button type="button" class="icon-btn danger" data-remove-admin="${attr(email)}" title="Remove ${attr(email)}" aria-label="Remove ${attr(email)}" ${email.toLowerCase() === CURRENT_ADMIN_EMAIL ? "disabled" : ""}><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button>
    </li>
  `).join("");
}

/* ---------- Utility ---------- */
function text(str) { return escapeHtml(str); }
function attr(str) { return escapeHtml(str).replaceAll("\n", " "); }
function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/* Bind one-time UI hooks that don't depend on rendered content */
document.addEventListener("DOMContentLoaded", () => {
  bindAddCarForm();
  bindUnitApprovalDialog();
  bindInquiryTools();
  bindChatMonitor();
});
