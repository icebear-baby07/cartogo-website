/* ===========================================================================
   carTOGO.mnl — ADMIN PANEL LOGIC (js/admin.js)
   Everything here reads/writes through DB (js/data.js). Public site content
   and inquiries are stored in MongoDB; authentication and admin roles use Supabase.

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
let SITE_ASSETS = [];
let SITE_ASSETS_ERROR = "";
let SELECTED_INQUIRY = null;
let SELECTED_INQUIRY_CARD_ID = null;
let ACTIVE_INQUIRY_TAB = "pending_review";
let REJECTING_INQUIRY = null;
let PENDING_INQUIRY_STATUS_CHANGE = null;
let DELETING_INQUIRY = null;
let CURRENT_ADMIN_EMAIL = "";
let UNIT_APPROVAL_CHALLENGE_ID = "";
let UNIT_APPROVAL_RESOLVE = null;
let UNIT_APPROVAL_RETURN_FOCUS = null;
let UNIT_APPROVAL_REQUEST_PENDING = false;
let UNIT_APPROVAL_SUBMITTING = false;
let UNIT_APPROVAL_RESOURCE = "unit";
let UNIT_APPROVAL_APPROVER = null;
const ADMIN_SIGN_IN_PENDING_KEY = "cartogo.adminGoogleSignInPending";

document.addEventListener("DOMContentLoaded", initAdmin);

async function initAdmin() {
  bindLogin();
  bindMobileSidebarMenu();
  if (!window.CARTOGO_CONFIG?.supabaseUrl || !window.CARTOGO_CONFIG?.supabaseAnonKey) {
    showLoginError("Supabase configuration is missing. Start the site with Cartogo/start_site.cmd after setting SUPABASE_URL and SUPABASE_ANON_KEY in main/cartogo-website/.env.");
    document.getElementById("adminGoogleSignIn").disabled = true;
    return;
  }

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

function bindMobileSidebarMenu() {
  const toggle = document.getElementById("adminMobileMenuToggle");
  const actions = document.getElementById("adminSidebarActions");
  const sidebar = document.querySelector(".admin-sidebar");
  const mobileViewport = window.matchMedia("(max-width: 820px)");
  const setExpanded = expanded => {
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.setAttribute("aria-label", expanded ? "Close admin menu" : "Open admin menu");
    actions.hidden = mobileViewport.matches && !expanded;
  };

  const syncViewport = () => setExpanded(false);
  setExpanded(false);
  mobileViewport.addEventListener("change", syncViewport);
  toggle.addEventListener("click", () => {
    setExpanded(toggle.getAttribute("aria-expanded") !== "true");
  });
  document.addEventListener("pointerdown", event => {
    if (mobileViewport.matches && !sidebar.contains(event.target)) setExpanded(false);
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && mobileViewport.matches && toggle.getAttribute("aria-expanded") === "true") {
      setExpanded(false);
      toggle.focus();
    }
  });
  actions.querySelectorAll("a, button").forEach(action => {
    action.addEventListener("click", () => {
      if (mobileViewport.matches) setExpanded(false);
    });
  });
  document.querySelectorAll(".admin-tab-btn").forEach(tab => {
    tab.addEventListener("click", () => {
      if (mobileViewport.matches) setExpanded(false);
    });
  });
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
  const loadingScreen = document.getElementById("adminLoginLoading");
  loadingScreen.hidden = false;
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
    renderSiteAssetsTab();
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
    loadingScreen.hidden = true;
  } catch (error) {
    loadingScreen.hidden = true;
    document.getElementById("adminShell").classList.remove("visible");
    document.getElementById("loginScreen").style.display = "flex";
    errorBox.textContent = `Admin access unavailable: ${error.message}`;
    errorBox.style.display = "block";
  }
}

async function loadAll() {
  SETTINGS = await DB.getSettings();
  LABELS = await DB.getLabels();
  UNITS = await DB.getUnits({ admin: true });
  try {
    SITE_ASSETS = await DB.getSiteAssets({ admin: true });
    SITE_ASSETS_ERROR = "";
  } catch (error) {
    SITE_ASSETS = [];
    SITE_ASSETS_ERROR = error.message;
  }
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
        UNITS = await DB.getUnits({ admin: true });
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
        UNITS = await DB.getUnits({ admin: true });
        renderFleetTab();
        toast(`Deleted ${unit.display_name}.`);
      } catch (error) {
        toast(error.message);
      }
    });
  });
}

async function requestAndApproveUnitChange(action, unit) {
  return requestAndApproveAdminChange("fleet unit", action, unit, DB.requestUnitChange, DB.approveUnitChange);
}

async function requestAndApproveSiteAssetChange(action, asset) {
  return requestAndApproveAdminChange("site asset", action, asset, DB.requestSiteAssetChange, DB.approveSiteAssetChange);
}

async function requestAndApproveAdminChange(resource, action, data, requestChange, approveChange) {
  const operation = action === "add" ? "Add" : action === "update" ? "Update" : action === "remove" ? "Remove" : "Delete";
  const targetName = data.display_name || data.loc_name || data.email || data.id || "requested change";
  showUnitApprovalLoading(operation, targetName, resource);
  try {
    const { challengeId, ownerEmail } = await requestChange(action, data);
    const approved = await openUnitApprovalDialog(challengeId, operation, targetName, resource, ownerEmail, approveChange);
    if (!approved) throw new Error("Approval cancelled. The code will expire in five minutes.");
  } catch (error) {
    UNIT_APPROVAL_REQUEST_PENDING = false;
    closeUnitApprovalDialog(false);
    throw error;
  }
}

function showUnitApprovalLoading(operation, unitName, resource) {
  const modal = document.getElementById("unitApprovalModal");
  const closeButtons = [document.getElementById("closeUnitApproval"), document.getElementById("cancelUnitApproval")];
  document.getElementById("unitApprovalTitle").textContent = `${operation} ${resource}`;
  document.getElementById("unitApprovalDescription").textContent = `Requesting the owner's approval PIN for ${unitName}.`;
  document.getElementById("unitApprovalLoadingText").textContent = "Sending owner PIN...";
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

function openUnitApprovalDialog(challengeId, operation, unitName, resource, ownerEmail, approveChange) {
  const modal = document.getElementById("unitApprovalModal");
  const codeInput = document.getElementById("unitApprovalCode");
  const closeButtons = [document.getElementById("closeUnitApproval"), document.getElementById("cancelUnitApproval")];
  document.getElementById("unitApprovalTitle").textContent = `${operation} ${resource}: ${unitName}`;
  document.getElementById("unitApprovalDescription").textContent = `Enter the six-digit owner PIN sent to ${ownerEmail}. It approves only this ${resource} change and expires in five minutes.`;
  document.getElementById("unitApprovalLoading").hidden = true;
  document.getElementById("unitApprovalForm").hidden = false;
  document.getElementById("unitApprovalError").hidden = true;
  document.getElementById("unitApprovalError").textContent = "";
  codeInput.value = "";
  UNIT_APPROVAL_CHALLENGE_ID = challengeId;
  UNIT_APPROVAL_RESOURCE = resource;
  UNIT_APPROVAL_APPROVER = approveChange;
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
      error.textContent = "Enter the six-digit owner PIN from the email.";
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
      await UNIT_APPROVAL_APPROVER(UNIT_APPROVAL_CHALLENGE_ID, code);
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
      UNITS = await DB.getUnits({ admin: true });
      renderFleetTab();
      form.reset();
      toast(`Added ${unit.display_name} to the unit data.`);
    } catch (error) {
      toast(error.message);
    }
  });
}

function renderSiteAssetsTab() {
  const errorBox = document.getElementById("siteAssetsError");
  errorBox.hidden = !SITE_ASSETS_ERROR;
  errorBox.style.display = SITE_ASSETS_ERROR ? "block" : "none";
  errorBox.textContent = SITE_ASSETS_ERROR
    ? `Could not load site assets: ${SITE_ASSETS_ERROR}. Run back/db/site_assets.sql in Supabase, then refresh this tab.`
    : "";

  const contact = SITE_ASSETS.find(asset => asset.asset_type === "contact");
  const contactFields = {
    siteContactDisplayName: contact?.display_name || "Live agent",
    siteContactPhone: contact?.phone || "",
    siteContactEmail: contact?.email || "",
    siteContactHours: contact?.operational_hours || "",
    siteContactStatus: contact?.status || "open",
    siteContactDescription: contact?.description || ""
  };
  Object.entries(contactFields).forEach(([id, value]) => {
    document.getElementById(id).value = value;
  });
  document.getElementById("saveSiteContactBtn").disabled = !contact?.id || Boolean(SITE_ASSETS_ERROR);

  const locations = SITE_ASSETS.filter(asset => asset.asset_type === "location");
  document.getElementById("siteAssetLocations").innerHTML = locations.length
    ? locations.map(asset => `
      <article class="fleet-item site-asset-item" data-id="${attr(asset.id)}">
        <div class="fleet-editor">
          <div class="site-asset-location-fields">
            <label class="fleet-field">Location name<input data-field="loc_name" value="${attr(asset.loc_name)}" required maxlength="120"></label>
            <label class="fleet-field">Display name<input data-field="display_name" value="${attr(asset.display_name)}" required maxlength="160"></label>
            <label class="fleet-field">Latitude<input data-field="latitude" type="number" min="-90" max="90" step="any" value="${attr(asset.coordinates?.lat ?? "")}" required></label>
            <label class="fleet-field">Longitude<input data-field="longitude" type="number" min="-180" max="180" step="any" value="${attr(asset.coordinates?.lng ?? "")}" required></label>
            <label class="fleet-field">Opening time<input data-field="opening_hours" type="time" value="${attr(String(asset.opening_hours || "").slice(0, 5))}"></label>
            <label class="fleet-field">Closing time<input data-field="closing_hours" type="time" value="${attr(String(asset.closing_hours || "").slice(0, 5))}"></label>
            <label class="fleet-field">Status<select data-field="status"><option value="open" ${asset.status === "open" ? "selected" : ""}>Open</option><option value="closed" ${asset.status === "closed" ? "selected" : ""}>Closed</option></select></label>
            <label class="fleet-field site-asset-description">Description<textarea data-field="description" rows="2" maxlength="600">${text(asset.description || "")}</textarea></label>
          </div>
          <div class="fleet-actions">
            <button class="btn btn-dark btn-sm save-site-location" type="button"><i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> Save location</button>
            <button class="icon-btn danger delete-site-location" type="button" title="Delete location" aria-label="Delete ${attr(asset.display_name)}"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button>
          </div>
        </div>
      </article>
    `).join("")
    : `<div class="empty-state">No pickup locations yet. Add one to place it on the public map.</div>`;
}

async function refreshSiteAssets() {
  try {
    SITE_ASSETS = await DB.getSiteAssets({ admin: true });
    SITE_ASSETS_ERROR = "";
  } catch (error) {
    SITE_ASSETS = [];
    SITE_ASSETS_ERROR = error.message;
  }
  renderSiteAssetsTab();
}

async function saveSiteAssetChange(action, asset, successMessage) {
  await requestAndApproveSiteAssetChange(action, asset);
  await refreshSiteAssets();
  toast(successMessage);
}

function bindSiteAssetsTab() {
  document.getElementById("siteAssetContactForm").addEventListener("submit", async event => {
    event.preventDefault();
    const contact = SITE_ASSETS.find(asset => asset.asset_type === "contact");
    if (!contact?.id) {
      toast("The contact record is missing. Run the site_assets.sql migration first.");
      return;
    }
    const asset = {
      id: contact.id,
      asset_type: "contact",
      display_name: document.getElementById("siteContactDisplayName").value.trim(),
      phone: document.getElementById("siteContactPhone").value.trim(),
      email: document.getElementById("siteContactEmail").value.trim(),
      operational_hours: document.getElementById("siteContactHours").value.trim(),
      status: document.getElementById("siteContactStatus").value,
      description: document.getElementById("siteContactDescription").value.trim()
    };
    try {
      await saveSiteAssetChange("update", asset, "Live-agent contact updated.");
    } catch (error) {
      toast(error.message);
    }
  });

  document.getElementById("showAddSiteLocationBtn").addEventListener("click", () => {
    const form = document.getElementById("siteAssetAddForm");
    form.hidden = !form.hidden;
    if (!form.hidden) form.querySelector("[name=loc_name]").focus();
  });
  document.getElementById("cancelAddSiteLocationBtn").addEventListener("click", () => {
    document.getElementById("siteAssetAddForm").reset();
    document.getElementById("siteAssetAddForm").hidden = true;
  });
  document.getElementById("siteAssetAddForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const asset = {
      asset_type: "location",
      loc_name: String(formData.get("loc_name")).trim(),
      display_name: String(formData.get("display_name")).trim(),
      coordinates: { lat: Number(formData.get("latitude")), lng: Number(formData.get("longitude")) },
      opening_hours: String(formData.get("opening_hours") || ""),
      closing_hours: String(formData.get("closing_hours") || ""),
      status: String(formData.get("status")),
      description: String(formData.get("description") || "").trim()
    };
    try {
      await saveSiteAssetChange("add", asset, `${asset.display_name} added to the site map.`);
      form.reset();
      form.hidden = true;
    } catch (error) {
      toast(error.message);
    }
  });

  document.getElementById("siteAssetLocations").addEventListener("click", async event => {
    const button = event.target.closest("button");
    if (!button) return;
    const row = button.closest(".site-asset-item");
    if (!row) return;
    const asset = {
      id: Number(row.dataset.id),
      asset_type: "location",
      loc_name: row.querySelector('[data-field="loc_name"]').value.trim(),
      display_name: row.querySelector('[data-field="display_name"]').value.trim(),
      coordinates: {
        lat: Number(row.querySelector('[data-field="latitude"]').value),
        lng: Number(row.querySelector('[data-field="longitude"]').value)
      },
      opening_hours: row.querySelector('[data-field="opening_hours"]').value,
      closing_hours: row.querySelector('[data-field="closing_hours"]').value,
      status: row.querySelector('[data-field="status"]').value,
      description: row.querySelector('[data-field="description"]').value.trim()
    };
    if (button.classList.contains("save-site-location")) {
      const invalidField = [...row.querySelectorAll("input, textarea")].find(field => !field.reportValidity());
      if (invalidField) return;
      try {
        await saveSiteAssetChange("update", asset, `${asset.display_name} updated.`);
      } catch (error) {
        toast(error.message);
      }
    } else if (button.classList.contains("delete-site-location")) {
      if (!confirm(`Delete "${asset.display_name}" from the public map? This can't be undone.`)) return;
      try {
        await saveSiteAssetChange("delete", { id: asset.id, asset_type: "location", display_name: asset.display_name }, `${asset.display_name} deleted.`);
      } catch (error) {
        toast(error.message);
      }
    }
  });

  document.getElementById("refreshSiteAssetsBtn").addEventListener("click", async () => {
    await refreshSiteAssets();
    toast(SITE_ASSETS_ERROR ? "Could not refresh site assets." : "Site assets refreshed.");
  });
}

/* ==========================================================================
   LABELS TAB — every editable piece of site copy
   ========================================================================== */
function renderLabelsTab() {
  const wrap = document.getElementById("labelsForm");
  const editableTrustItems = LABELS.trustStrip.filter(item => !isAutomaticFleetStat(item));
  const howItWorksSteps = [...(Array.isArray(LABELS.howItWorks) ? LABELS.howItWorks : [])];
  if (!howItWorksSteps.some(step => step.title?.trim().toLowerCase() === "return the vehicle")) {
    howItWorksSteps.push({
      title: "Return the vehicle",
      description: "Bring the car back at the agreed time and place. Contact our team in advance if you need to request a change."
    });
  }

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
      <h3>How it works slideshow</h3>
      <div id="howRepeat">${howItWorksSteps.map((step) => `
        <div class="repeat-item">
          <div class="label-field"><label>Step title</label><input class="how-title" value="${attr(step.title)}"></div>
          <div class="label-field"><label>Step description</label><textarea class="how-desc" rows="2">${text(step.description)}</textarea></div>
        </div>
      `).join("")}</div>
      <p style="font-size:0.8rem; color:var(--slate-light); margin-top:-0.4rem;">Steps appear in this order in the public slideshow. The return procedure is added automatically if it is missing.</p>
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
    delete newLabels.contact;
    try {
      await requestAndApproveAdminChange(
        "site content",
        "update",
        { labels: newLabels },
        (action, data) => DB.requestOwnerChange("site_content", action, data),
        DB.approveOwnerChange
      );
      LABELS = await DB.getLabels();
      toast("Labels saved. Refresh the main site to see changes.");
    } catch (error) {
      toast(`Could not save labels: ${error.message}`);
    }
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
async function renderInquiriesTab({ reload = true } = {}) {
  const content = document.getElementById("inquiriesContent");
  const countBadge = document.getElementById("inquiryCount");
  const metrics = document.getElementById("inquiryMetrics");
  if (reload) {
    try {
      INQUIRIES = await DB.getInquiries();
    } catch (error) {
      countBadge.textContent = "Unavailable";
      metrics.replaceChildren();
      content.innerHTML = `<div class="empty-state inquiry-load-error" role="alert">Could not load inquiries from MongoDB: ${text(error.message)} <button class="btn btn-ghost btn-sm" id="retryInquiriesBtn" type="button"><i class="fa-solid fa-rotate" aria-hidden="true"></i> Try again</button></div>`;
      return false;
    }
  }

  const count = INQUIRIES.length;
  countBadge.textContent = `${displayInquiryCount(count)} inquir${count === 1 ? "y" : "ies"}`;
  const statuses = [
    ["pending_review", "Pending Overview", "fa-inbox"],
    ["confirmed", "Confirmed", "fa-circle-check"],
    ["operating", "Operating", "fa-car-side"],
    ["rejected", "Rejected", "fa-ban"]
  ];
  const statusCounts = new Map(statuses.map(([value]) => [value, 0]));
  INQUIRIES.forEach(inquiry => {
    const status = inquiryStatus(inquiry);
    if (statusCounts.has(status)) statusCounts.set(status, statusCounts.get(status) + 1);
  });
  metrics.innerHTML = statuses.map(([value, label, icon]) => `
    <button class="inquiry-metric inquiry-metric-${value}${ACTIVE_INQUIRY_TAB === value ? " is-active" : ""}" id="inquiry-tab-${value}" type="button" role="tab" data-inquiry-filter="${value}" aria-selected="${ACTIVE_INQUIRY_TAB === value}" aria-controls="inquiriesContent" tabindex="${ACTIVE_INQUIRY_TAB === value ? "0" : "-1"}">
      <i class="fa-solid ${icon} inquiry-metric-icon" aria-hidden="true"></i>
      <span class="inquiry-metric-count">${displayInquiryCount(statusCounts.get(value))}</span>
      <span class="inquiry-metric-label">${label}</span>
    </button>
  `).join("");
  document.getElementById("inquiriesContent").setAttribute("aria-labelledby", `inquiry-tab-${ACTIVE_INQUIRY_TAB}`);

  if (ACTIVE_INQUIRY_TAB === "operating") {
    content.innerHTML = `
      <section class="admin-card operating-placeholder" aria-labelledby="operatingPlaceholderTitle">
        <div class="operating-placeholder-art" aria-hidden="true">
          <span class="operating-placeholder-orbit operating-placeholder-orbit-one"></span>
          <span class="operating-placeholder-orbit operating-placeholder-orbit-two"></span>
          <i class="fa-solid fa-car-side"></i>
        </div>
        <div class="operating-placeholder-copy">
          <span class="operating-placeholder-badge"><span></span> In development</span>
          <h2 id="operatingPlaceholderTitle">Operating dashboard coming soon</h2>
          <p>This part is reserved to track current units in use. The tools for monitoring active rentals are not available yet.</p>
          <div class="operating-placeholder-progress" aria-label="This dashboard is not available yet">
            <span></span><span></span><span></span><span></span>
          </div>
          <small>Unit tracking is not available yet</small>
        </div>
      </section>
    `;
    return true;
  }

  const activeStatus = statuses.find(([value]) => value === ACTIVE_INQUIRY_TAB);
  const inquiries = INQUIRIES.filter(inquiry => inquiryStatus(inquiry) === ACTIVE_INQUIRY_TAB);
  if (inquiries.length === 0) {
    const emptyMessage = count === 0
      ? "No inquiries yet — new booking submissions will appear here."
      : `No inquiries in ${activeStatus[1]}.`;
    content.innerHTML = `<div class="admin-card"><div class="empty-state">${emptyMessage}</div></div>`;
    return true;
  }

  content.innerHTML = `
    <section class="admin-card inquiry-status-section inquiry-status-section-${activeStatus[0]}" aria-labelledby="inquiry-section-${activeStatus[0]}">
      <header class="inquiry-section-header">
        <div>
          <h2 id="inquiry-section-${activeStatus[0]}">${activeStatus[1]}</h2>
          <p>${displayInquiryCount(inquiries.length)} ${inquiries.length === 1 ? "inquiry" : "inquiries"}</p>
        </div>
        <span class="inquiry-section-count">${displayInquiryCount(inquiries.length)}</span>
      </header>
      <div class="inquiry-card-grid ${inquiries.length === 1 ? "is-single" : inquiries.length >= 8 ? "is-dense" : "is-standard"}" data-count="${inquiries.length}">
        ${inquiries.map(inq => {
          const submitted = inquiryDisplayDate(inq.created_at || inq.submittedAt);
          const status = inquiryStatus(inq);
          const rental = inq.rental_mode === "hourly"
            ? `${text(inq.rental_period_hours ?? "—")}-hour rental`
            : `${text(inq.rental_days ?? "—")} custom days`;
          const coordinates = getInquiryCoordinates(inq);
          const isRejected = status === "rejected";
          return `
            <article class="inquiry-card inquiry-card-${status}${String(inq.id) === String(SELECTED_INQUIRY_CARD_ID) ? " is-selected" : ""}" data-id="${attr(inq.id)}" tabindex="0" aria-label="Inquiry from ${attr(inq.name || "Unnamed customer")}">
              <div class="inquiry-card-topline">
                <span class="inquiry-card-submitted">${text(submitted)}</span>
                <div class="inquiry-card-controls">
                  ${isRejected
                    ? `<span class="inquiry-status-badge status-rejected">Rejected</span>`
                    : status === "pending_review" ? `<button class="icon-btn inquiry-confirm-action" type="button" title="Confirm inquiry" aria-label="Confirm inquiry"><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>`
                    : `<span class="inquiry-status-badge status-confirmed">Confirmed</span>`}
                  ${isRejected
                    ? inq.rejection_email_sent === false
                      ? `<button class="icon-btn retry-rejection-email" type="button" title="Retry rejection email" aria-label="Retry rejection email"><i class="fa-solid fa-envelope" aria-hidden="true"></i></button>`
                      : ""
                    : `<button class="icon-btn inquiry-reject-action" type="button" title="Reject inquiry and email customer" aria-label="Reject inquiry and email customer"><i class="fa-solid fa-ban" aria-hidden="true"></i></button>`}
                  ${isRejected
                    ? `<button class="icon-btn inquiry-restore-action" type="button" title="Restore inquiry to Pending Overview" aria-label="Restore inquiry to Pending Overview"><i class="fa-solid fa-arrow-rotate-left" aria-hidden="true"></i></button>`
                    : ""}
                </div>
              </div>
              <h3 class="inquiry-card-name">${text(inq.name || "Unnamed customer")}</h3>
              <p class="inquiry-card-contact">${text(inq.email || "No email")} <span aria-hidden="true">·</span> ${text(inq.phone || "No phone")}</p>
              <div class="inquiry-card-summary">
                <div><span>Vehicle</span><strong>${text(inq.car_name || inq.carName || "—")}</strong></div>
                <div><span>Dates</span><strong>${text(inq.pickup_date || inq.pickupDate || "—")} ${text(inq.pickup_time || inq.pickupTime || "")} → ${text(inq.return_date || inq.returnDate || "—")}</strong></div>
                <div><span>Destination</span><strong>${text(inq.location || "—")}</strong></div>
              </div>
              <details class="inquiry-disclosure">
                <summary><span>Read more</span><i class="fa-solid fa-chevron-down" aria-hidden="true"></i></summary>
                <dl class="inquiry-card-details">
                  <div><dt>Capacity</dt><dd>${text(inq.capacity ?? "—")}</dd></div>
                  <div><dt>Rental arrangement</dt><dd>${rental}</dd></div>
                  <div><dt>Rate region</dt><dd>${text(inq.rate_region || "—")}</dd></div>
                  <div><dt>Quoted rate</dt><dd>${text(inq.quoted_rate ?? "—")}</dd></div>
                  <div><dt>Discount</dt><dd>${text(inq.discount_percent ?? 0)}% · ${text(inq.discount_amount ?? 0)}</dd></div>
                  <div><dt>Nearest pickup</dt><dd>${text(inq.nearest_pickup_name || "—")} · ${text(inq.nearest_pickup_distance_km ?? "—")} km</dd></div>
                  <div class="inquiry-card-detail-wide"><dt>Target coordinates</dt><dd>${text(coordinates ? `${coordinates.latitude}, ${coordinates.longitude}` : "—")} ${coordinates ? `<a class="inquiry-map-link" href="${getGoogleMapsUrl(coordinates)}" target="_blank" rel="noopener noreferrer" title="Show coordinates in map" aria-label="Show coordinates in map"><i class="fa-solid fa-map-location-dot" aria-hidden="true"></i></a>` : ""}</dd></div>
                  ${inq.rejection_reason ? `<div class="inquiry-card-detail-wide"><dt>Rejection reason</dt><dd class="preserve-lines">${text(inq.rejection_reason)}</dd></div>` : ""}
                  ${inq.notes ? `<div class="inquiry-card-detail-wide"><dt>Notes</dt><dd class="preserve-lines">${text(inq.notes)}</dd></div>` : ""}
                </dl>
                <div class="inquiry-card-actions">
                  <button class="btn btn-ghost btn-sm view-inquiry" type="button"><i class="fa-solid fa-eye" aria-hidden="true"></i> Full record</button>
                  <button class="icon-btn danger delete-inquiry" type="button" title="Delete inquiry" aria-label="Delete inquiry"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button>
                </div>
              </details>
            </article>
          `;
        }).join("")}
      </div>
    </section>
  `;
  return true;
}

function inquiryStatus(inquiry) {
  return ["pending_review", "contacted", "confirmed", "rejected"].includes(inquiry.status)
    ? inquiry.status
    : "pending_review";
}

function inquiryStatusLabel(status) {
  return {
    pending_review: "Pending review",
    contacted: "Contacted",
    confirmed: "Confirmed",
    rejected: "Rejected"
  }[status] || "Pending review";
}

function displayInquiryCount(count) {
  return count > 99 ? "99+" : String(count);
}

function getInquiryCoordinates(inquiry) {
  const rawLatitude = inquiry.target_latitude ?? inquiry.targetLatitude;
  const rawLongitude = inquiry.target_longitude ?? inquiry.targetLongitude;
  if (rawLatitude === null || rawLatitude === undefined || rawLatitude === ""
    || rawLongitude === null || rawLongitude === undefined || rawLongitude === "") return null;
  const latitude = Number(rawLatitude);
  const longitude = Number(rawLongitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
    || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

function getGoogleMapsUrl(coordinates) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${coordinates.latitude},${coordinates.longitude}`)}`;
}

function inquiryDisplayDate(value) {
  if (!value) return "Submission date unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Submission date unavailable"
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function exportInquiryCsv(inquiry) {
  const row = [
    ["Submitted", "Name", "Email", "Phone", "Secondary phone", "Unit", "Unit ID", "Capacity", "Pickup date", "Pickup time", "Return date", "Target location", "Target latitude", "Target longitude", "Nearest pickup", "Distance km", "Rate region", "Rental mode", "Rate period hours", "Estimated hours", "Rental days", "Rate per period", "Discount percent", "Discount amount", "Quoted rate", "Status", "Rejection reason", "Rejection email sent", "Notes"],
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
      inquiry.rental_mode || "",
      inquiry.rental_period_hours ?? "",
      inquiry.estimated_rental_hours ?? "",
      inquiry.rental_days ?? "",
      inquiry.rate_per_period ?? "",
      inquiry.discount_percent ?? "",
      inquiry.discount_amount ?? "",
      inquiry.quoted_rate ?? "",
      inquiry.status || "New",
      inquiry.rejection_reason || "",
      inquiry.rejection_email_sent ? "yes" : "no",
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
  const coordinates = getInquiryCoordinates(inquiry);
  const status = inquiryStatus(inquiry);
  document.getElementById("inquiryDetailTitle").textContent = inquiry.name || "Inquiry details";
  document.getElementById("inquiryDetailMeta").textContent = submitted ? `Submitted ${formatDate(submitted)}` : "Submission time unavailable";
  document.getElementById("inquiryDetails").innerHTML = `
    <div class="inquiry-detail-grid">
      <div><dt>Full name</dt><dd>${text(inquiry.name)}</dd></div>
      <div><dt>Status</dt><dd><span class="status-pill status-${status}">${text(inquiryStatusLabel(status))}</span></dd></div>
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
      <div><dt>Target coordinates</dt><dd>${text(coordinates ? `${coordinates.latitude}, ${coordinates.longitude}` : "—")} ${coordinates ? `<a class="inquiry-map-link" href="${getGoogleMapsUrl(coordinates)}" target="_blank" rel="noopener noreferrer" title="Show coordinates in map" aria-label="Show coordinates in map"><i class="fa-solid fa-map-location-dot" aria-hidden="true"></i></a>` : ""}</dd></div>
      <div><dt>Nearest pickup</dt><dd>${text(inquiry.nearest_pickup_name || "—")} · ${text(inquiry.nearest_pickup_distance_km ?? "—")} km</dd></div>
      <div><dt>Quoted rate</dt><dd>${text(inquiry.rate_region || "—")} · ${inquiry.rental_mode === "hourly" ? `${text(inquiry.rental_period_hours ?? "—")}-hour rental` : `${text(inquiry.rental_days ?? "—")} custom days`} · ${text(inquiry.quoted_rate ?? "—")}</dd></div>
      <div><dt>Promo discount</dt><dd>${text(inquiry.discount_percent ?? 0)}% · ${text(inquiry.discount_amount ?? 0)}</dd></div>
      ${inquiry.rejection_reason ? `<div class="inquiry-detail-wide"><dt>Rejection reason</dt><dd class="preserve-lines">${text(inquiry.rejection_reason)}</dd></div>` : ""}
      ${inquiry.status === "rejected" ? `<div><dt>Rejection email</dt><dd>${inquiry.rejection_email_sent ? "Sent" : "Not sent — retry from the inquiry card"}</dd></div>` : ""}
      <div class="inquiry-detail-wide"><dt>Notes</dt><dd class="preserve-lines">${text(inquiry.notes || "—")}</dd></div>
    </div>
  `;
  document.getElementById("inquiryDetailModal").hidden = false;
  document.getElementById("closeInquiryDetail").focus();
}

function openInquiryStatusConfirmation(id, previousStatus, nextStatus, returnFocus) {
  const inquiry = INQUIRIES.find(item => String(item.id) === String(id));
  if (!inquiry || previousStatus === nextStatus || nextStatus === "rejected") return;
  const transitionCopy = {
    pending_review: previousStatus === "rejected" ? {
      title: "Restore this inquiry?",
      description: "This inquiry will return to Pending Overview. Its rejection reason and rejection-email retry state will be cleared. No email will be sent."
    } : null,
    confirmed: {
      title: "Confirm this inquiry?",
      description: "This inquiry will move to Confirmed. This status change does not send an email to the customer."
    }
  }[nextStatus];
  if (!transitionCopy) return;

  PENDING_INQUIRY_STATUS_CHANGE = { id, previousStatus, nextStatus, returnFocus };
  document.getElementById("inquiryStatusTitle").textContent = transitionCopy.title;
  document.getElementById("inquiryStatusDescription").textContent =
    `${transitionCopy.description} Customer: ${inquiry.name || "Unnamed customer"}.`;
  document.getElementById("inquiryStatusCurrent").textContent = inquiryStatusLabel(previousStatus);
  const target = document.getElementById("inquiryStatusTarget");
  target.textContent = inquiryStatusLabel(nextStatus);
  target.className = `status-confirmation-target status-confirmation-target-${nextStatus}`;
  document.getElementById("inquiryStatusError").hidden = true;
  document.getElementById("proceedInquiryStatus").disabled = false;
  document.getElementById("proceedInquiryStatus").textContent = "Confirm update";
  const modal = document.getElementById("inquiryStatusModal");
  modal.hidden = false;
  document.getElementById("cancelInquiryStatus").focus();
}

function closeInquiryStatusConfirmation({ restoreFocus = true } = {}) {
  const pendingChange = PENDING_INQUIRY_STATUS_CHANGE;
  document.getElementById("inquiryStatusModal").hidden = true;
  PENDING_INQUIRY_STATUS_CHANGE = null;
  if (restoreFocus && pendingChange?.returnFocus?.isConnected) pendingChange.returnFocus.focus();
}

function openInquiryDelete(id, returnFocus) {
  const inquiry = INQUIRIES.find(item => String(item.id) === String(id));
  if (!inquiry) return;
  DELETING_INQUIRY = { inquiry, returnFocus };
  document.getElementById("inquiryDeleteName").textContent = inquiry.name || "Unnamed customer";
  document.getElementById("inquiryDeleteEmail").textContent = inquiry.email || "No email provided";
  document.getElementById("inquiryDeleteVehicle").textContent =
    inquiry.car_name || inquiry.carName || "No vehicle specified";
  document.getElementById("inquiryDeleteError").hidden = true;
  document.getElementById("proceedInquiryDelete").disabled = false;
  document.getElementById("proceedInquiryDelete").innerHTML =
    '<i class="fa-solid fa-trash-can" aria-hidden="true"></i> Delete permanently';
  document.getElementById("inquiryDeleteModal").hidden = false;
  document.getElementById("cancelInquiryDelete").focus();
}

function closeInquiryDelete({ restoreFocus = true } = {}) {
  const pendingDelete = DELETING_INQUIRY;
  document.getElementById("inquiryDeleteModal").hidden = true;
  DELETING_INQUIRY = null;
  if (restoreFocus && pendingDelete?.returnFocus?.isConnected) pendingDelete.returnFocus.focus();
}

function openInquiryRejection(id) {
  const inquiry = INQUIRIES.find(item => String(item.id) === String(id));
  if (!inquiry || inquiry.status === "rejected") return;
  REJECTING_INQUIRY = inquiry;
  const modal = document.getElementById("inquiryRejectionModal");
  const reasonInput = document.getElementById("inquiryRejectionReason");
  document.getElementById("inquiryRejectionDescription").textContent =
    `${inquiry.name || "This customer"} will receive an email at ${inquiry.email || "the address on their inquiry"}.`;
  reasonInput.value = "";
  updateRejectionPreview();
  document.getElementById("inquiryRejectionError").hidden = true;
  document.getElementById("proceedInquiryRejection").disabled = false;
  modal.hidden = false;
  reasonInput.focus();
}

function updateRejectionPreview() {
  const reason = document.getElementById("inquiryRejectionReason").value.trim();
  const words = reason ? reason.split(/\s+/).length : 0;
  document.getElementById("inquiryRejectionWordCount").textContent = `${words} / 250 words`;
  document.getElementById("inquiryRejectionWordCount").classList.toggle("is-over-limit", words > 250);
  document.getElementById("inquiryRejectionPreviewReason").textContent =
    reason || "Your explanation will appear here.";
  const name = REJECTING_INQUIRY?.name || "customer";
  document.getElementById("inquiryRejectionPreviewGreeting").textContent = `Dear ${name},`;
}

function closeInquiryRejection() {
  const modal = document.getElementById("inquiryRejectionModal");
  modal.hidden = true;
  REJECTING_INQUIRY = null;
}

function bindInquiryTools() {
  document.getElementById("refreshInquiriesBtn").addEventListener("click", async () => {
    toast(await renderInquiriesTab() ? "Inquiries refreshed." : "Could not refresh inquiries.");
  });

  document.getElementById("inquiriesContent").addEventListener("click", async event => {
    const card = event.target.closest(".inquiry-card");
    if (event.target.closest("#retryInquiriesBtn")) {
      toast(await renderInquiriesTab() ? "Inquiries refreshed." : "Could not refresh inquiries.");
      return;
    }
    if (!card) return;
    SELECTED_INQUIRY_CARD_ID = card.dataset.id;
    document.querySelectorAll(".inquiry-card.is-selected").forEach(selected => selected.classList.remove("is-selected"));
    card.classList.add("is-selected");
    if (event.target.closest(".view-inquiry")) {
      showInquiryDetails(card.dataset.id);
      return;
    }
    const confirmButton = event.target.closest(".inquiry-confirm-action");
    if (confirmButton) {
      openInquiryStatusConfirmation(card.dataset.id, "pending_review", "confirmed", confirmButton);
      return;
    }
    if (event.target.closest(".inquiry-reject-action") && !event.target.closest(".inquiry-reject-action").disabled) {
      openInquiryRejection(card.dataset.id);
      return;
    }
    const restoreButton = event.target.closest(".inquiry-restore-action");
    if (restoreButton) {
      openInquiryStatusConfirmation(card.dataset.id, "rejected", "pending_review", restoreButton);
      return;
    }
    if (event.target.closest(".retry-rejection-email")) {
      const button = event.target.closest(".retry-rejection-email");
      button.disabled = true;
      try {
        const result = await DB.resendInquiryRejection(card.dataset.id);
        await renderInquiriesTab();
        toast(result.emailSent ? "Rejection email sent." : "Inquiry is rejected, but the email could not be sent. Check SMTP and retry.");
      } catch (error) {
        toast(`Could not resend rejection email: ${error.message}`);
        button.disabled = false;
      }
      return;
    }
    const deleteButton = event.target.closest(".delete-inquiry");
    if (deleteButton) openInquiryDelete(card.dataset.id, deleteButton);
  });

  const statusModal = document.getElementById("inquiryStatusModal");
  const statusForm = document.getElementById("inquiryStatusForm");
  const closeStatus = () => closeInquiryStatusConfirmation();
  document.getElementById("closeInquiryStatus").addEventListener("click", closeStatus);
  document.getElementById("cancelInquiryStatus").addEventListener("click", closeStatus);
  statusModal.addEventListener("click", event => {
    if (event.target === statusModal) closeStatus();
  });
  statusForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!PENDING_INQUIRY_STATUS_CHANGE) return;
    const { id, nextStatus } = PENDING_INQUIRY_STATUS_CHANGE;
    const proceed = document.getElementById("proceedInquiryStatus");
    const error = document.getElementById("inquiryStatusError");
    proceed.disabled = true;
    proceed.textContent = "Updating…";
    error.hidden = true;
    try {
      if (nextStatus === "pending_review") await DB.restoreInquiry(id);
      else await DB.updateInquiry(id, { status: nextStatus });
      closeInquiryStatusConfirmation({ restoreFocus: false });
      const successMessage = nextStatus === "pending_review"
        ? "Inquiry restored to Pending Overview."
        : "Inquiry status updated successfully.";
      toast(await renderInquiriesTab() ? successMessage : `${successMessage} The list could not be refreshed.`);
    } catch (requestError) {
      error.textContent = `Could not update inquiry: ${requestError.message}`;
      error.hidden = false;
    } finally {
      if (!statusModal.hidden) {
        proceed.disabled = false;
        proceed.textContent = "Confirm update";
      }
    }
  });

  const deleteModal = document.getElementById("inquiryDeleteModal");
  const deleteForm = document.getElementById("inquiryDeleteForm");
  const closeDelete = () => closeInquiryDelete();
  document.getElementById("closeInquiryDelete").addEventListener("click", closeDelete);
  document.getElementById("cancelInquiryDelete").addEventListener("click", closeDelete);
  deleteModal.addEventListener("click", event => {
    if (event.target === deleteModal) closeDelete();
  });
  deleteForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!DELETING_INQUIRY) return;
    const inquiryId = DELETING_INQUIRY.inquiry.id;
    const proceed = document.getElementById("proceedInquiryDelete");
    const error = document.getElementById("inquiryDeleteError");
    proceed.disabled = true;
    proceed.textContent = "Deleting…";
    error.hidden = true;
    try {
      await DB.deleteInquiry(Number(inquiryId));
      if (String(SELECTED_INQUIRY_CARD_ID) === String(inquiryId)) SELECTED_INQUIRY_CARD_ID = null;
      closeInquiryDelete({ restoreFocus: false });
      toast(await renderInquiriesTab() ? "Inquiry deleted." : "Inquiry deleted, but the list could not be refreshed.");
    } catch (requestError) {
      error.textContent = `Could not delete inquiry: ${requestError.message}`;
      error.hidden = false;
    } finally {
      if (!deleteModal.hidden) {
        proceed.disabled = false;
        proceed.innerHTML = '<i class="fa-solid fa-trash-can" aria-hidden="true"></i> Delete permanently';
      }
    }
  });

  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    if (!statusModal.hidden) closeStatus();
    else if (!deleteModal.hidden) closeDelete();
  });

  const inquiryTabs = document.getElementById("inquiryMetrics");
  inquiryTabs.addEventListener("click", async event => {
    const tab = event.target.closest("[data-inquiry-filter]");
    if (!tab) return;
    ACTIVE_INQUIRY_TAB = tab.dataset.inquiryFilter;
    await renderInquiriesTab({ reload: false });
  });
  inquiryTabs.addEventListener("keydown", async event => {
    const tab = event.target.closest("[data-inquiry-filter]");
    if (!tab || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const tabs = Array.from(inquiryTabs.querySelectorAll("[data-inquiry-filter]"));
    const currentIndex = tabs.indexOf(tab);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (currentIndex + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
    ACTIVE_INQUIRY_TAB = tabs[nextIndex].dataset.inquiryFilter;
    await renderInquiriesTab({ reload: false });
    document.getElementById(`inquiry-tab-${ACTIVE_INQUIRY_TAB}`).focus();
  });

  document.getElementById("inquiriesContent").addEventListener("keydown", event => {
    const card = event.target.closest(".inquiry-card");
    if (!card || event.target !== card || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    SELECTED_INQUIRY_CARD_ID = card.dataset.id;
    document.querySelectorAll(".inquiry-card.is-selected").forEach(selected => selected.classList.remove("is-selected"));
    card.classList.add("is-selected");
  });

  const rejectionModal = document.getElementById("inquiryRejectionModal");
  const rejectionForm = document.getElementById("inquiryRejectionForm");
  const closeRejection = () => closeInquiryRejection();
  document.getElementById("closeInquiryRejection").addEventListener("click", closeRejection);
  document.getElementById("cancelInquiryRejection").addEventListener("click", closeRejection);
  document.getElementById("inquiryRejectionReason").addEventListener("input", updateRejectionPreview);
  rejectionModal.addEventListener("click", event => {
    if (event.target === rejectionModal) closeRejection();
  });
  rejectionForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!REJECTING_INQUIRY) return;
    const reason = document.getElementById("inquiryRejectionReason").value.trim();
    const words = reason ? reason.split(/\s+/).length : 0;
    const error = document.getElementById("inquiryRejectionError");
    if (!reason || words > 250) {
      error.textContent = !reason ? "Enter a reason before proceeding." : "Keep the explanation within 250 words.";
      error.hidden = false;
      return;
    }
    const inquiryId = REJECTING_INQUIRY.id;
    const proceed = document.getElementById("proceedInquiryRejection");
    proceed.disabled = true;
    proceed.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Sending…';
    error.hidden = true;
    try {
      const result = await DB.rejectInquiry(inquiryId, reason);
      closeInquiryRejection();
      await renderInquiriesTab();
      toast(result.emailSent
        ? "Inquiry rejected and customer email sent."
        : "Inquiry rejected, but the customer email could not be sent. Use the retry email button after checking SMTP.");
    } catch (requestError) {
      error.textContent = `Could not reject inquiry: ${requestError.message}`;
      error.hidden = false;
    } finally {
      proceed.disabled = false;
      proceed.innerHTML = '<i class="fa-solid fa-paper-plane" aria-hidden="true"></i> Reject and email customer';
    }
  });

  document.getElementById("exportCsvBtn").addEventListener("click", () => {
    if (INQUIRIES.length === 0) { toast("No inquiries to export yet."); return; }
    const headers = ["Submitted", "Name", "Email", "Phone", "Unit", "Capacity", "Pickup Date", "Pickup Time", "Return Date", "Location", "Rate Region", "Rental Mode", "Rental Days", "Rate Period Hours", "Discount Percent", "Discount Amount", "Quoted Rate", "Status", "Rejection Reason", "Rejection Email Sent", "Notes"];
    const rows = INQUIRIES.map(i => [
      i.submittedAt || i.created_at || "", i.name, i.email, i.phone, i.carName || i.car_name, i.capacity ?? "",
      i.pickupDate || i.pickup_date, i.pickup_time || i.pickupTime || "", i.returnDate || i.return_date, i.location || "", i.rate_region || "",
      i.rental_mode || "", i.rental_days ?? "", i.rental_period_hours ?? "", i.discount_percent ?? "", i.discount_amount ?? "",
      i.quoted_rate ?? "", i.status, i.rejection_reason || "", i.rejection_email_sent ? "yes" : "no", (i.notes || "").replace(/\n/g, " ")
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
      try {
        await requestAndApproveAdminChange(
          "chat session",
          "delete",
          { id },
          (action, data) => DB.requestOwnerChange("chat_sessions", action, data),
          DB.approveOwnerChange
        );
        closeChatTranscriptModal();
        await renderChatMonitor();
        toast("Chat session deleted.");
      } catch (error) {
        toast(`Could not delete chat session: ${error.message}`);
      }
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
  document.getElementById("inquiryRejectionModal").addEventListener("click", event => {
    if (event.target.id === "inquiryRejectionModal") closeInquiryRejection();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      closeChatTranscriptModal();
      closeInquiryDetailModal();
      closeInquiryRejection();
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
      <div><h2>Danger zone</h2><p>Resets local fleet, labels, and site preferences. Customer inquiries and admin authorization are not changed.</p></div>
      <button type="button" class="btn btn-ghost btn-sm" id="resetAllBtn">Reset everything to defaults</button>
    </section>
  `;
  renderAdminAccounts();

  document.getElementById("addAdminEmailBtn").addEventListener("click", async () => {
    const input = document.getElementById("newAdminEmail");
    const email = input.value.trim().toLowerCase();
    if (!input.reportValidity()) return;
    try {
      await requestAndApproveAdminChange(
        "administrator account",
        "add",
        { email },
        (action, data) => DB.requestOwnerChange("admin_accounts", action, data),
        DB.approveOwnerChange
      );
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
      await requestAndApproveAdminChange(
        "administrator account",
        "remove",
        { email },
        (action, data) => DB.requestOwnerChange("admin_accounts", action, data),
        DB.approveOwnerChange
      );
      SETTINGS.adminEmails = await DB.getAdminEmails();
      renderAdminAccounts();
      toast("Administrator account removed.");
    } catch (error) {
      toast(`Could not remove administrator: ${error.message}`);
    }
  });

  document.getElementById("saveSettingsBtn").addEventListener("click", async () => {
    try {
      const settings = {
        companyName: document.getElementById("setCompanyName").value.trim(),
        currency: document.getElementById("setCurrency").value.trim() || "$",
        depositPercent: Number(document.getElementById("setDeposit").value) || 0,
        extraDriverFee: Number(document.getElementById("setExtraDriver").value) || 0,
        childSeatFee: Number(document.getElementById("setChildSeat").value) || 0,
        lateFeePerHour: Number(document.getElementById("setLateFee").value) || 0
      };
      await requestAndApproveAdminChange(
        "site settings",
        "update",
        { settings },
        (action, data) => DB.requestOwnerChange("site_content", action, data),
        DB.approveOwnerChange
      );
      SETTINGS = { ...SETTINGS, ...await DB.getSettings() };
      toast("Settings saved.");
    } catch (error) {
      toast(`Could not save settings: ${error.message}`);
    }
  });

  document.getElementById("resetAllBtn").addEventListener("click", async () => {
    if (!confirm("Reset public settings and page copy to defaults? Fleet, site assets, booking inquiries, and chat sessions will remain unchanged.")) return;
    try {
      const defaults = await DB.getSiteContentDefaults();
      await requestAndApproveAdminChange(
        "site settings and page content",
        "update",
        { settings: defaults.settings, labels: defaults.labels },
        (action, data) => DB.requestOwnerChange("site_content", action, data),
        DB.approveOwnerChange
      );
      await loadAll();
      SETTINGS.adminEmails = await DB.getAdminEmails();
      renderFleetTab();
      renderLabelsTab();
      await renderInquiriesTab();
      await renderChatMonitor();
      renderSettingsTab();
      toast("Everything reset to defaults.");
    } catch (error) {
      toast(`Could not reset site content: ${error.message}`);
    }
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
  bindSiteAssetsTab();
  bindInquiryTools();
  bindChatMonitor();
});
