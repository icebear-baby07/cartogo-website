/* ==========================================================================
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
let CARS = [];
let INQUIRIES = [];
let CHAT_SESSIONS = [];
let SELECTED_INQUIRY = null;

document.addEventListener("DOMContentLoaded", initAdmin);

async function initAdmin() {
  SETTINGS = await DB.getSettings();
  bindLogin();

  // Stay logged in for this browser tab session only.
  if (sessionStorage.getItem("carTOGOAdminAuthed") === "yes") {
    await enterAdmin();
  }
}

/* ---------- Login ---------- */
function bindLogin() {
  const form = document.getElementById("loginForm");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("loginPassword").value;
    const errorBox = document.getElementById("loginError");
    if (input === SETTINGS.adminPassword) {
      sessionStorage.setItem("carTOGOAdminAuthed", "yes");
      errorBox.style.display = "none";
      await enterAdmin();
    } else {
      errorBox.textContent = "Incorrect password. Try again.";
      errorBox.style.display = "block";
    }
  });

  document.getElementById("logoutBtn").addEventListener("click", () => {
    sessionStorage.removeItem("carTOGOAdminAuthed");
    document.getElementById("adminShell").classList.remove("visible");
    document.getElementById("loginScreen").style.display = "flex";
    document.getElementById("loginPassword").value = "";
  });
}

async function enterAdmin() {
  document.getElementById("loginScreen").style.display = "none";
  document.getElementById("adminShell").classList.add("visible");
  await loadAll();
  bindTabs();
  renderFleetTab();
  renderLabelsTab();
  await renderInquiriesTab();
  await renderChatMonitor();
  renderSettingsTab();
}

async function loadAll() {
  SETTINGS = await DB.getSettings();
  LABELS = await DB.getLabels();
  CARS = await DB.getCars();
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
   FLEET TAB — add / edit / delete cars and their rates
   ========================================================================== */
function renderFleetTab() {
  const tbody = document.getElementById("fleetTableBody");
  if (CARS.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state">No cars yet. Add your first one below.</div></td></tr>`;
    return;
  }
  tbody.innerHTML = CARS.map(car => `
    <tr data-id="${car.id}">
      <td><input type="text" class="f-name" value="${attr(car.name)}"></td>
      <td><input type="text" class="f-category" value="${attr(car.category)}"></td>
      <td><input type="number" class="f-seats" value="${car.seats}" min="1" max="30"></td>
      <td><input type="text" class="f-transmission" value="${attr(car.transmission)}"></td>
      <td><input type="text" class="f-fuel" value="${attr(car.fuel)}"></td>
      <td><input type="number" class="f-rate" value="${car.rate}" min="0" step="50"></td>
      <td><input type="text" class="f-image" value="${attr(car.image)}" placeholder="images/yourcar.jpg" style="min-width:150px;"></td>
      <td>
        <select class="f-available">
          <option value="true" ${car.available ? "selected" : ""}>Available</option>
          <option value="false" ${!car.available ? "selected" : ""}>Booked out</option>
        </select>
      </td>
      <td class="row-actions">
        <button class="icon-btn save-car" title="Save row"><i class="fa-solid fa-floppy-disk" aria-hidden="true"></i></button>
        <button class="icon-btn danger delete-car" title="Delete car"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button>
      </td>
    </tr>
  `).join("");

  tbody.querySelectorAll(".save-car").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const row = e.target.closest("tr");
      const id = row.dataset.id;
      const car = CARS.find(c => c.id === id);
      const updated = {
        ...car,
        name: row.querySelector(".f-name").value.trim(),
        category: row.querySelector(".f-category").value.trim(),
        seats: Number(row.querySelector(".f-seats").value) || 1,
        transmission: row.querySelector(".f-transmission").value.trim(),
        fuel: row.querySelector(".f-fuel").value.trim(),
        rate: Number(row.querySelector(".f-rate").value) || 0,
        image: row.querySelector(".f-image").value.trim(),
        available: row.querySelector(".f-available").value === "true"
      };
      await DB.saveCar(updated);
      CARS = await DB.getCars();
      toast(`Saved changes to ${updated.name}.`);
    });
  });

  tbody.querySelectorAll(".delete-car").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const row = e.target.closest("tr");
      const id = row.dataset.id;
      const car = CARS.find(c => c.id === id);
      if (!confirm(`Delete "${car.name}" from the fleet? This can't be undone.`)) return;
      await DB.deleteCar(id);
      CARS = await DB.getCars();
      renderFleetTab();
      toast(`Deleted ${car.name}.`);
    });
  });
}

function bindAddCarForm() {
  const form = document.getElementById("addCarForm");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const newCar = {
      name: document.getElementById("newCarName").value.trim(),
      category: document.getElementById("newCarCategory").value.trim(),
      seats: Number(document.getElementById("newCarSeats").value) || 4,
      transmission: document.getElementById("newCarTransmission").value.trim() || "Automatic",
      fuel: document.getElementById("newCarFuel").value.trim() || "Gasoline",
      rate: Number(document.getElementById("newCarRate").value) || 0,
      blurb: document.getElementById("newCarBlurb").value.trim() || "A great pick for your next trip.",
      image: document.getElementById("newCarImage").value.trim(),
      available: true
    };
    if (!newCar.name || !newCar.category) {
      toast("Please fill in at least a name and category.");
      return;
    }
    await DB.saveCar(newCar);
    CARS = await DB.getCars();
    renderFleetTab();
    form.reset();
    toast(`Added ${newCar.name} to the fleet.`);
  });
}

/* ==========================================================================
   LABELS TAB — every editable piece of site copy
   ========================================================================== */
function renderLabelsTab() {
  const wrap = document.getElementById("labelsForm");

  wrap.innerHTML = `
    <div class="label-group">
      <h3>Hero</h3>
      <div class="label-field"><label>Headline (HTML ok, e.g. &lt;em&gt;)</label><input id="lblHeroTitle" value="${attr(LABELS.hero.title)}"></div>
      <div class="label-field"><label>Subheadline</label><textarea id="lblHeroSubtitle" rows="2">${text(LABELS.hero.subtitle)}</textarea></div>
    </div>

    <div class="label-group">
      <h3>Trust strip (4 stats)</h3>
      <div id="trustRepeat">${LABELS.trustStrip.map((item, i) => `
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
      toast("Keep at least one pickup point — the booking form needs one to work.");
      return;
    }

    const newLabels = {
      ...LABELS,
      hero: {
        title: document.getElementById("lblHeroTitle").value,
        subtitle: document.getElementById("lblHeroSubtitle").value
      },
      trustStrip: [...document.querySelectorAll("#trustRepeat .repeat-item")].map(item => ({
        value: item.querySelector(".trust-value").value,
        label: item.querySelector(".trust-label").value
      })),
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
<td>${text(inq.pickup_date || "N/A")} &rarr; ${text(inq.return_date || "N/A")}</td>
<td>${text(inq.location || "-")}</td>
      <td>
        <select class="status-select status-${inq.status}">
          ${["New", "Contacted", "Confirmed", "Completed", "Cancelled"].map(s =>
            `<option value="${s}" ${inq.status === s ? "selected" : ""}>${s}</option>`
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
      const id = Number(e.target.closest("tr").dataset.id);
      await DB.updateInquiry(id, { status: e.target.value });
      e.target.className = `status-select status-${e.target.value}`;
      toast("Status updated.");
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
    ["Submitted", "Name", "Email", "Phone", "Secondary phone", "Car", "Car ID", "Pickup date", "Return date", "Pickup point", "Status", "Notes"],
    [
      inquiry.created_at || inquiry.submittedAt || "",
      inquiry.name || "",
      inquiry.email || "",
      inquiry.phone || "",
      inquiry.secondary_phone || "",
      inquiry.car_name || inquiry.carName || "",
      inquiry.car_id || inquiry.carId || "",
      inquiry.pickup_date || inquiry.pickupDate || "",
      inquiry.return_date || inquiry.returnDate || "",
      inquiry.location || "",
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
      <div><dt>Email</dt><dd>${text(inquiry.email)}</dd></div>
      <div><dt>Phone number</dt><dd>${text(inquiry.phone)}</dd></div>
      <div><dt>Secondary phone</dt><dd>${text(inquiry.secondary_phone || "—")}</dd></div>
      <div><dt>Vehicle</dt><dd>${text(inquiry.car_name || inquiry.carName || "—")}</dd></div>
      <div><dt>Pickup date</dt><dd>${text(inquiry.pickup_date || inquiry.pickupDate || "—")}</dd></div>
      <div><dt>Return date</dt><dd>${text(inquiry.return_date || inquiry.returnDate || "—")}</dd></div>
      <div><dt>Pickup point</dt><dd>${text(inquiry.location || "—")}</dd></div>
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
    const headers = ["Submitted", "Name", "Email", "Phone", "Car", "Pickup Date", "Return Date", "Location", "Status", "Notes"];
    const rows = INQUIRIES.map(i => [
      i.submittedAt, i.name, i.email, i.phone, i.carName, i.pickupDate, i.returnDate, i.location || "", i.status, (i.notes || "").replace(/\n/g, " ")
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

/* ==========================================================================
   SETTINGS TAB — company info, currency, fees, admin password
   ========================================================================== */
function renderSettingsTab() {
  const wrap = document.getElementById("settingsForm");
  wrap.innerHTML = `
    <div class="label-field"><label>Company name</label><input id="setCompanyName" value="${attr(SETTINGS.companyName)}"></div>
    <div class="label-field"><label>Currency symbol</label><input id="setCurrency" value="${attr(SETTINGS.currency)}" maxlength="3"></div>
    <div class="label-field"><label>Deposit percentage (% of daily rate)</label><input id="setDeposit" type="number" value="${SETTINGS.depositPercent}"></div>
    <div class="label-field"><label>Extra driver fee</label><input id="setExtraDriver" type="number" value="${SETTINGS.extraDriverFee}"></div>
    <div class="label-field"><label>Child seat fee</label><input id="setChildSeat" type="number" value="${SETTINGS.childSeatFee}"></div>
    <div class="label-field"><label>Late return fee (per hour)</label><input id="setLateFee" type="number" value="${SETTINGS.lateFeePerHour}"></div>
    <div class="label-field"><label>Admin password</label><input id="setPassword" type="text" value="${attr(SETTINGS.adminPassword)}"></div>
    <button type="button" class="btn btn-primary" id="saveSettingsBtn">Save settings</button>

    <div class="admin-card" style="margin-top:1.75rem; border: 1px dashed var(--danger);">
      <h2 style="color:var(--danger);">Danger zone</h2>
      <p class="sub">Resets the fleet, labels, settings, and deletes ALL inquiries back to the sample data. Cannot be undone.</p>
      <button type="button" class="btn btn-ghost btn-sm" id="resetAllBtn" style="border-color:var(--danger); color:var(--danger);">Reset everything to defaults</button>
    </div>
  `;

  document.getElementById("saveSettingsBtn").addEventListener("click", async () => {
    await DB.saveSettings({
      companyName: document.getElementById("setCompanyName").value.trim(),
      currency: document.getElementById("setCurrency").value.trim() || "$",
      depositPercent: Number(document.getElementById("setDeposit").value) || 0,
      extraDriverFee: Number(document.getElementById("setExtraDriver").value) || 0,
      childSeatFee: Number(document.getElementById("setChildSeat").value) || 0,
      lateFeePerHour: Number(document.getElementById("setLateFee").value) || 0,
      adminPassword: document.getElementById("setPassword").value.trim() || SETTINGS.adminPassword
    });
    SETTINGS = await DB.getSettings();
    toast("Settings saved.");
  });

  document.getElementById("resetAllBtn").addEventListener("click", async () => {
    if (!confirm("This wipes every edit and all inquiries back to sample data. Continue?")) return;
    await DB.resetAll();
    await loadAll();
    renderFleetTab();
    renderLabelsTab();
    await renderInquiriesTab();
    await renderChatMonitor();
    renderSettingsTab();
    toast("Everything reset to defaults.");
  });
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
  bindInquiryTools();
  bindChatMonitor();
});
