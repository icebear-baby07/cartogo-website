import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { supabase } from "../supabase";
import defaultSiteContent from "./site-content-defaults.json";

type AdminProfile = { email: string; titles: string[] };
type DataRecord = Record<string, unknown>;
type DashboardTab = "inquiries" | "fleet" | "assets" | "content" | "chat" | "analytics";
type OwnerChange = {
  resource: string;
  action: string;
  data: DataRecord;
};
type ApprovalChallenge = {
  challengeId: string;
  ownerEmail: string;
  expiresIn: number;
};

const tabs: { id: DashboardTab; label: string; permission: string }[] = [
  { id: "inquiries", label: "Inquiries", permission: "inquiries" },
  { id: "fleet", label: "Fleet & rates", permission: "fleet" },
  { id: "assets", label: "Site assets", permission: "site_assets" },
  { id: "content", label: "Site content", permission: "site_content" },
  { id: "chat", label: "Chat monitor", permission: "chat" },
  { id: "analytics", label: "Analytics", permission: "analytics" },
];

const permissionsByTitle: Record<string, string[]> = {
  Owner: ["inquiries", "fleet", "site_assets", "site_content", "chat", "analytics"],
  Moderator: ["inquiries", "fleet", "site_assets", "site_content", "chat", "analytics"],
};

function isRecord(value: unknown): value is DataRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function records(value: unknown): DataRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function text(value: unknown, fallback = "—"): string {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function date(value: unknown): string {
  if (typeof value !== "string" && !(value instanceof Date)) return "Date unavailable";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "Date unavailable"
    : parsed.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

async function adminRequest(path: string, init: RequestInit = {}): Promise<unknown> {
  const { data, error } = await supabase?.auth.getSession() ?? { data: { session: null }, error: null };
  if (error) throw new Error(`Could not read the sign-in session: ${error.message}`);
  const token = data.session?.access_token;
  if (!token) throw new Error("Your admin session has expired. Sign in again.");

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...init, headers, cache: "no-store" });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      isRecord(body) && typeof body.error === "string"
        ? body.error
        : `Request failed (${response.status}).`,
    );
  }
  return body;
}

function parseEditor(value: string, label: string): DataRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }
  if (!isRecord(parsed)) throw new Error(`${label} must be a JSON object.`);
  return parsed;
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function exportInquiryCsv(inquiries: DataRecord[]): void {
  const columns = [
    ["id", "Inquiry ID"],
    ["created_at", "Submitted"],
    ["name", "Customer name"],
    ["email", "Email"],
    ["phone", "Phone"],
    ["secondary_phone", "Secondary phone"],
    ["car_name", "Vehicle"],
    ["car_id", "Unit ID"],
    ["capacity", "Capacity"],
    ["requested_capacity", "Requested seats"],
    ["pickup_date", "Pickup date"],
    ["pickup_time", "Pickup time"],
    ["return_date", "Return date"],
    ["rate_region", "Rate region"],
    ["rental_mode", "Rental mode"],
    ["rental_period_hours", "Rate period hours"],
    ["estimated_rental_hours", "Estimated hours"],
    ["rental_days", "Rental days"],
    ["rate_per_period", "Rate per period"],
    ["discount_percent", "Discount percent"],
    ["discount_amount", "Discount amount"],
    ["rental_subtotal", "Rental subtotal"],
    ["extra_driver", "Extra Driver selected"],
    ["extra_driver_fee", "Extra Driver fee"],
    ["child_seat", "Child seat selected"],
    ["child_seat_fee", "Child seat fee"],
    ["quoted_rate", "Quoted rate"],
    ["status", "Status"],
    ["rejection_reason", "Rejection reason"],
    ["rejection_email_sent", "Rejection email sent"],
    ["notes", "Notes"],
  ] as const;
  const aliases: Record<string, string> = {
    created_at: "submittedAt",
    car_name: "carName",
    car_id: "carId",
    pickup_date: "pickupDate",
    pickup_time: "pickupTime",
    return_date: "returnDate",
    rate_region: "rateRegion",
    rental_mode: "rentalMode",
    rental_period_hours: "rentalPeriodHours",
    estimated_rental_hours: "estimatedRentalHours",
    rental_days: "rentalDays",
    rate_per_period: "ratePerPeriod",
    discount_percent: "discountPercent",
    discount_amount: "discountAmount",
    rental_subtotal: "rentalSubtotal",
    extra_driver: "extraDriver",
    extra_driver_fee: "extraDriverFee",
    child_seat: "childSeat",
    child_seat_fee: "childSeatFee",
    quoted_rate: "quotedRate",
    rejection_reason: "rejectionReason",
    rejection_email_sent: "rejectionEmailSent",
  };
  const escape = (value: unknown) => {
    let cell = value === null || value === undefined ? "" : String(value);
    if (/^[\u0000-\u0020]*[=+\-@]/.test(cell)) cell = `'${cell}`;
    return `"${cell.replaceAll('"', '""')}"`;
  };
  const rows = inquiries.map((inquiry) =>
    columns.map(([key]) => escape(inquiry[key] ?? inquiry[aliases[key] ?? ""])).join(","),
  );
  const contents = `\uFEFF${columns.map(([, label]) => escape(label)).join(",")}\r\n${rows.join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([contents], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `cartogo-inquiries-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function AdminDashboard({
  email,
  onSignOut,
}: {
  email: string;
  onSignOut: () => void;
}) {
  const [tab, setTab] = useState<DashboardTab>(() => {
    const savedTab = window.sessionStorage.getItem("cartogo-admin-tab");
    return tabs.find((item) => item.id === savedTab)?.id ?? "inquiries";
  });
  const [profile, setProfile] = useState<AdminProfile | null>(null);
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [approvals, setApprovals] = useState<Partial<Record<DashboardTab, ApprovalChallenge>>>({});
  const [approvalCodes, setApprovalCodes] = useState<Partial<Record<DashboardTab, string>>>({});
  const [approvalPendingByTab, setApprovalPendingByTab] = useState<Partial<Record<DashboardTab, boolean>>>({});
  const [ownerChangePending, setOwnerChangePending] = useState(false);
  const [editor, setEditor] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [filter, setFilter] = useState("all");
  const [rejection, setRejection] = useState<{ id: number; reason: string } | null>(null);
  const [rejectionPendingId, setRejectionPendingId] = useState<number | null>(null);
  const [scrollToEditor, setScrollToEditor] = useState(false);
  const [scrollToApprovalTab, setScrollToApprovalTab] = useState<DashboardTab | null>(null);
  const loadSequence = useRef(0);
  const initialTab = useRef(tab);
  const recordEditorRef = useRef<HTMLFormElement>(null);
  const approvalFormRef = useRef<HTMLFormElement>(null);

  const allowedPermissions = useMemo(
    () => new Set((profile?.titles ?? []).flatMap((title) => permissionsByTitle[title] ?? [])),
    [profile],
  );
  const visibleTabs = tabs.filter((item) => allowedPermissions.has(item.permission));
  const approval = approvals[tab] ?? null;
  const approvalCode = approvalCodes[tab] ?? "";
  const approvalPending = approvalPendingByTab[tab] ?? false;

  useEffect(() => {
    if (!scrollToEditor || !editor || (tab !== "fleet" && tab !== "assets")) return;
    recordEditorRef.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    });
    setScrollToEditor(false);
  }, [editor, scrollToEditor, tab]);

  useEffect(() => {
    if (scrollToApprovalTab !== tab || !approval) return;
    approvalFormRef.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    });
    setScrollToApprovalTab(null);
  }, [approval, scrollToApprovalTab, tab]);

  const loadTab = useCallback(async (selected: DashboardTab) => {
    const requestId = ++loadSequence.current;
    setLoading(true);
    setError("");
    setNotice("");
    setData(null);
    setEditor("");
    setEditingId(null);
    try {
      const path: Record<DashboardTab, string> = {
        inquiries: "/api/admin/inquiries",
        fleet: "/api/admin/units",
        assets: "/api/admin/site-assets",
        content: "/api/admin/site-content",
        chat: "/api/admin/chat-sessions",
        analytics: "",
      };
      if (selected === "analytics") {
        if (requestId === loadSequence.current) setData([]);
        return;
      }
      const result = await adminRequest(path[selected]);
      if (requestId === loadSequence.current) setData(result);
    } catch (loadError) {
      if (requestId === loadSequence.current) {
        setError(loadError instanceof Error ? loadError.message : "Could not load this admin section.");
      }
    } finally {
      if (requestId === loadSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = "Admin dashboard — carTOGO.mnl";
    let active = true;
    void adminRequest("/api/admin/me")
      .then((result) => {
        if (!active) return;
        if (
          !isRecord(result) ||
          typeof result.email !== "string" ||
          !Array.isArray(result.titles) ||
          !result.titles.every((title) => typeof title === "string")
        ) {
          throw new Error("The API returned an invalid admin profile.");
        }
        setProfile({ email: result.email, titles: result.titles });
      })
      .catch((profileError: unknown) => {
        if (active) setError(profileError instanceof Error ? profileError.message : "Could not load admin access.");
      });
    void loadTab(initialTab.current);
    return () => {
      active = false;
    };
  }, [loadTab]);

  async function refresh() {
    await loadTab(tab);
  }

  async function requestOwnerChange(change: OwnerChange) {
    if (ownerChangePending) return;
    const requestTab = tab;
    setOwnerChangePending(true);
    setError("");
    setNotice("");
    try {
      const result = await adminRequest("/api/admin/owner-change/request", {
        method: "POST",
        body: JSON.stringify(change),
      });
      if (!isRecord(result) || typeof result.challengeId !== "string" || typeof result.ownerEmail !== "string") {
        throw new Error("The API returned an invalid owner-approval response.");
      }
      setApprovals((current) => ({ ...current, [requestTab]: {
        challengeId: result.challengeId,
        ownerEmail: result.ownerEmail,
        expiresIn: typeof result.expiresIn === "number" ? result.expiresIn : 300,
      } }));
      setApprovalCodes((current) => ({ ...current, [requestTab]: "" }));
      setScrollToApprovalTab(requestTab);
      setNotice(`Approval PIN sent to ${result.ownerEmail}.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not request owner approval.");
    } finally {
      setOwnerChangePending(false);
    }
  }

  async function approveChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const approvalForTab = approvals[tab];
    if (!approvalForTab) return;
    setApprovalPendingByTab((current) => ({ ...current, [tab]: true }));
    setError("");
    try {
      await adminRequest("/api/admin/owner-change/approve", {
        method: "POST",
        body: JSON.stringify({ challengeId: approvalForTab.challengeId, code: approvalCodes[tab] ?? "" }),
      });
      setApprovals((current) => {
        const next = { ...current };
        delete next[tab];
        return next;
      });
      setApprovalCodes((current) => {
        const next = { ...current };
        delete next[tab];
        return next;
      });
      await loadTab(tab);
      setNotice("The approved change was applied.");
    } catch (approvalError) {
      setError(approvalError instanceof Error ? approvalError.message : "Could not approve this change.");
    } finally {
      setApprovalPendingByTab((current) => ({ ...current, [tab]: false }));
    }
  }

  async function inquiryAction(id: number, action: string, extras: DataRecord = {}) {
    const isRejection = action === "reject" || action === "resend_rejection";
    if (isRejection) setRejectionPendingId(id);
    setError("");
    setNotice("");
    try {
      const result = await adminRequest("/api/admin/inquiries", {
        method: "POST",
        body: JSON.stringify({ id, action, ...extras }),
      });
      const emailWarning =
        isRecord(result) && result.emailSent === false && typeof result.emailError === "string"
          ? ` ${result.emailError}`
          : "";
      setRejection(null);
      await loadTab("inquiries");
      setNotice(action === "reject" || action === "resend_rejection"
        ? "Inquiry Rejected."
        : `Inquiry updated.${emailWarning}`);
    } catch (actionError) {
      const message = actionError instanceof Error ? actionError.message : "Could not update the inquiry.";
      if (action === "reject" || action === "resend_rejection") await loadTab("inquiries");
      setError(message);
    } finally {
      if (isRejection) setRejectionPendingId(null);
    }
  }

  function beginEdit(record: DataRecord, idField = "id") {
    setEditor(pretty(record));
    setEditingId(typeof record[idField] === "number" ? record[idField] as number : null);
  }

  async function submitJsonChange(
    event: FormEvent<HTMLFormElement>,
    resource: string,
    action: string,
    includeId: boolean,
  ) {
    event.preventDefault();
    try {
      const value = parseEditor(editor, "Record");
      if (!includeId) delete value.id;
      await requestOwnerChange({ resource, action, data: value });
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : "Could not prepare this change.");
    }
  }

  async function submitContentChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const value = parseEditor(editor || pretty(data), "Site content");
      if (!isRecord(value.settings) || !isRecord(value.labels)) {
        throw new Error("Site content must include settings and labels objects.");
      }
      const editableLabelFields = [
        "termsAndConditions",
        "hero",
        "trustStrip",
        "howItWorks",
        "whyChooseUs",
        "about",
        "faq",
        "testimonials",
      ];
      const labels = Object.fromEntries(
        Object.entries(value.labels).filter(([key]) => editableLabelFields.includes(key)),
      );
      await requestOwnerChange({
        resource: "site_content",
        action: "update",
        data: {
          settings: value.settings,
          labels,
          discountRules: value.discountRules,
          socialLinks: value.socialLinks,
        },
      });
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : "Could not prepare this change.");
    }
  }

  function renderInquiries() {
    const inquiries = records(data);
    const visible = inquiries.filter((inquiry) =>
      filter === "all" || (text(inquiry.status, "pending_review") === filter),
    );
    const status = (item: DataRecord) => text(item.status, "pending_review");
    return (
      <>
        <div className="admin-toolbar">
          <label className="admin-field admin-filter">
            Status
            <select value={filter} onChange={(event) => setFilter(event.target.value)}>
              <option value="all">All inquiries ({inquiries.length})</option>
              <option value="pending_review">Pending review</option>
              <option value="contacted">Contacted</option>
              <option value="confirmed">Confirmed</option>
            </select>
          </label>
          <button
            className="button button-ghost"
            type="button"
            disabled={!visible.length}
            onClick={() => exportInquiryCsv(visible)}
          >
            Export CSV
          </button>
          <button className="button button-ghost" type="button" onClick={() => void refresh()}>Refresh</button>
        </div>
        {visible.length ? (
          <div className="admin-card-list">
            {visible.map((inquiry, index) => {
              const id = Number(inquiry.id);
              const currentStatus = status(inquiry);
              return (
                <article
                  className={`admin-card${currentStatus === "confirmed" ? " admin-inquiry-confirmed" : ""}`}
                  key={String(inquiry.id ?? index)}
                >
                  <div className="admin-card-heading">
                    <div>
                      <p className="eyebrow">{currentStatus.replaceAll("_", " ")}</p>
                      <h2>{text(inquiry.name ?? inquiry.firstName, "Unnamed customer")}</h2>
                      <p>{date(inquiry.created_at ?? inquiry.submittedAt)} · {text(inquiry.car_name ?? inquiry.carName, "Vehicle not specified")}</p>
                    </div>
                    <span className="admin-record-id">#{text(inquiry.id)}</span>
                  </div>
                  <dl className="admin-detail-grid">
                    <div><dt>Email</dt><dd>{text(inquiry.email)}</dd></div>
                    <div><dt>Phone</dt><dd>{text(inquiry.phone)}</dd></div>
                    <div><dt>Pickup</dt><dd>{text(inquiry.pickup_date ?? inquiry.pickupDate)} {text(inquiry.pickup_time ?? inquiry.pickupTime, "")}</dd></div>
                    <div><dt>Return</dt><dd>{text(inquiry.return_date ?? inquiry.returnDate)}</dd></div>
                    {typeof inquiry.requested_capacity === "number" ? <div><dt>Requested seats</dt><dd>{text(inquiry.requested_capacity)}</dd></div> : null}
                    <div><dt>Rental subtotal</dt><dd>{text(inquiry.rental_subtotal ?? inquiry.rentalSubtotal ?? inquiry.quoted_rate ?? inquiry.quotedRate)}</dd></div>
                    {inquiry.extra_driver === true || inquiry.extraDriver === true ? <div><dt>Extra Driver</dt><dd>Selected · {text(inquiry.extra_driver_fee ?? inquiry.extraDriverFee, "0")}</dd></div> : null}
                    {inquiry.child_seat === true || inquiry.childSeat === true ? <div><dt>Child seat</dt><dd>Selected · {text(inquiry.child_seat_fee ?? inquiry.childSeatFee, "0")}</dd></div> : null}
                    <div><dt>Estimated total</dt><dd>{text(inquiry.quoted_rate ?? inquiry.quotedRate)}</dd></div>
                    {typeof inquiry.notes === "string" && inquiry.notes ? <div className="admin-detail-wide"><dt>Notes</dt><dd>{inquiry.notes}</dd></div> : null}
                    {typeof inquiry.rejection_reason === "string" && inquiry.rejection_reason ? <div className="admin-detail-wide"><dt>Rejection reason</dt><dd>{inquiry.rejection_reason}</dd></div> : null}
                  </dl>
                  <div className="admin-actions">
                    {currentStatus !== "confirmed" && currentStatus !== "rejected" ? (
                      <button className="button button-primary" type="button" onClick={() => void inquiryAction(id, "update", { status: "confirmed" })}>Confirm</button>
                    ) : null}
                    {currentStatus !== "rejected" ? (
                      <button className="button button-ghost" type="button" onClick={() => setRejection({ id, reason: "" })}>Reject</button>
                    ) : typeof inquiry.rejection_reason === "string" && inquiry.rejection_reason.trim() ? (
                      <button className="button button-danger" type="button" disabled={rejectionPendingId !== null} aria-busy={rejectionPendingId === id} onClick={() => void inquiryAction(id, "reject")}>
                        {rejectionPendingId === id ? "Rejecting inquiry…" : inquiry.rejection_email_sent === true ? "Finish deletion" : "Retry email & delete"}
                      </button>
                    ) : (
                      <button className="button button-danger" type="button" onClick={() => setRejection({ id, reason: "" })}>Add reason and finish rejection</button>
                    )}
                  </div>
                  {rejection?.id === id ? (
                    <form className="admin-rejection-form" onSubmit={(event) => {
                      event.preventDefault();
                      void inquiryAction(id, "reject", { reason: rejection.reason });
                    }}>
                      <label className="admin-field">Reason (required, max 250 words)
                        <textarea required maxLength={3000} rows={3} disabled={rejectionPendingId !== null} value={rejection.reason} onChange={(event) => setRejection({ id, reason: event.target.value })} />
                      </label>
                      <p>The inquiry is deleted only after the email is accepted by the configured mail server.</p>
                      <div className="admin-actions">
                        <button className="button button-primary" type="submit" disabled={rejectionPendingId !== null} aria-busy={rejectionPendingId === id}>
                          {rejectionPendingId === id ? <><span className="admin-rejection-spinner" aria-hidden="true" /> Rejecting inquiry…</> : "Email customer and delete inquiry"}
                        </button>
                        <button className="button button-ghost" type="button" disabled={rejectionPendingId !== null} onClick={() => setRejection(null)}>Cancel</button>
                      </div>
                    </form>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : <p className="admin-empty">No inquiries in this status.</p>}
      </>
    );
  }

  function renderFleet() {
    const units = records(data);
    const emptyUnit = {
      display_name: "", brand: "", model: "", capacity: 5, in12_rate: 0,
      in24_rate: 0, out12_rate: 0, out24_rate: 0, luzon_rate: 0,
      status: "Available", features: [],
    };
    return (
      <>
        <div className="admin-toolbar admin-fleet-toolbar">
          <div className="admin-fleet-count">
            <p>{units.length} fleet units</p>
            <button
              className={`admin-fleet-refresh${loading ? " is-refreshing" : ""}`}
              type="button"
              aria-label="Refresh fleet units"
              title="Refresh fleet units"
              disabled={loading}
              onClick={() => void refresh()}
            >
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M20 7v5h-5M4 17v-5h5m-4.1-3A7.5 7.5 0 0 1 17.6 6L20 12M4 12l2.4 6a7.5 7.5 0 0 0 12.7-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
        {units.map((unit, index) => (
          <article className="admin-list-row admin-fleet-row" key={String(unit.id ?? index)}>
            <div><strong>{text(unit.display_name)}</strong><span>#{text(unit.id)} · {text(unit.status)} · {text(unit.capacity)} seats</span><span>{text(unit.brand)} {text(unit.model)}</span></div>
            <div className="admin-actions">
              <button className="button button-ghost" type="button" onClick={() => {
                beginEdit(unit);
                setScrollToEditor(true);
              }}>Edit</button>
              <button className="button button-danger" type="button" disabled={ownerChangePending} aria-busy={ownerChangePending} onClick={() => {
                if (window.confirm(`Delete ${text(unit.display_name)} from the fleet?`)) {
                  void requestOwnerChange({ resource: "unit", action: "delete", data: { id: unit.id, display_name: unit.display_name } });
                }
              }}>{ownerChangePending && <span className="admin-request-spinner" aria-hidden="true" />}{ownerChangePending ? "Requesting approval…" : "Delete"}</button>
            </div>
          </article>
        ))}
        <button className="button button-ghost admin-add-unit" type="button" onClick={() => {
          setEditingId(null);
          setEditor(pretty(emptyUnit));
          setScrollToEditor(true);
        }}>
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 3v14M3 10h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          <span>Add unit</span>
        </button>
        {editor ? (
          <form ref={recordEditorRef} className="admin-card admin-json-editor" onSubmit={(event) => void submitJsonChange(event, "unit", editingId === null ? "add" : "update", true)}>
            <h2>{editingId === null ? "Add fleet unit" : `Edit fleet unit #${editingId}`}</h2>
            <p>Enter the complete unit record as JSON. New unit IDs are assigned by the API.</p>
            <label className="admin-field">Unit data<textarea value={editor} onChange={(event) => setEditor(event.target.value)} rows={13} spellCheck={false} /></label>
            <div className="admin-actions"><button className="button button-primary" type="submit" disabled={ownerChangePending} aria-busy={ownerChangePending}>{ownerChangePending && <span className="admin-request-spinner" aria-hidden="true" />}{ownerChangePending ? "Requesting approval…" : "Request owner approval"}</button><button className="button button-ghost" type="button" disabled={ownerChangePending} onClick={() => { setEditor(""); setEditingId(null); }}>Cancel</button></div>
          </form>
        ) : null}
      </>
    );
  }

  function renderAssets() {
    const assets = records(data);
    const emptyAsset = {
      asset_type: "location", display_name: "", description: "", status: "open",
      loc_name: "", coordinates: { lat: null, lng: null },
      opening_hours: "", closing_hours: "",
    };
    return (
      <>
        <div className="admin-toolbar admin-fleet-toolbar">
          <div className="admin-fleet-count">
            <p>{assets.length} site assets</p>
            <button
              className={`admin-fleet-refresh${loading ? " is-refreshing" : ""}`}
              type="button"
              aria-label="Refresh site assets"
              title="Refresh site assets"
              disabled={loading}
              onClick={() => void refresh()}
            >
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M20 7v5h-5M4 17v-5h5m-4.1-3A7.5 7.5 0 0 1 17.6 6L20 12M4 12l2.4 6a7.5 7.5 0 0 0 12.7-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
        {assets.map((asset, index) => (
          <article className="admin-list-row" key={String(asset.id ?? index)}>
            <div><strong>{text(asset.display_name)}</strong><span>#{text(asset.id)} · {text(asset.asset_type)} · {text(asset.status)}</span><span>{text(asset.description)}</span></div>
            <div className="admin-actions">
              <button className="button button-ghost" type="button" onClick={() => {
                beginEdit(asset);
                setScrollToEditor(true);
              }}>Edit</button>
              {asset.asset_type === "location" ? <button className="button button-danger" type="button" disabled={ownerChangePending} aria-busy={ownerChangePending} onClick={() => {
                if (window.confirm(`Delete pickup location ${text(asset.display_name)}?`)) {
                  void requestOwnerChange({ resource: "site_assets", action: "delete", data: { id: asset.id, asset_type: "location" } });
                }
              }}>{ownerChangePending && <span className="admin-request-spinner" aria-hidden="true" />}{ownerChangePending ? "Requesting approval…" : "Delete"}</button> : null}
            </div>
          </article>
        ))}
        <button className="button button-ghost admin-add-asset" type="button" onClick={() => {
          setEditingId(null);
          setEditor(pretty(emptyAsset));
          setScrollToEditor(true);
        }}>
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 3v14M3 10h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          <span>Add pickup location</span>
        </button>
        {editor ? (
          <form ref={recordEditorRef} className="admin-card admin-json-editor" onSubmit={(event) => void submitJsonChange(event, "site_assets", editingId === null ? "add" : "update", true)}>
            <h2>{editingId === null ? "Add pickup location" : `Edit site asset #${editingId}`}</h2>
            <p>Enter the pickup location coordinates as latitude and longitude; there is no default location. After owner approval, the record is saved in MongoDB&apos;s <code>site_assets</code> collection and used by the public map. The live-agent contact can be edited but not added or deleted here.</p>
            <label className="admin-field">Asset data<textarea value={editor} onChange={(event) => setEditor(event.target.value)} rows={12} spellCheck={false} /></label>
            <div className="admin-actions"><button className="button button-primary" type="submit" disabled={ownerChangePending} aria-busy={ownerChangePending}>{ownerChangePending && <span className="admin-request-spinner" aria-hidden="true" />}{ownerChangePending ? "Requesting approval…" : "Request owner approval"}</button><button className="button button-ghost" type="button" disabled={ownerChangePending} onClick={() => { setEditor(""); setEditingId(null); }}>Cancel</button></div>
          </form>
        ) : null}
      </>
    );
  }

  function renderContent() {
    return (
      <>
        <form className="admin-card admin-json-editor" onSubmit={(event) => void submitContentChange(event)}>
          <h2>Edit public site content</h2>
          <p>Preserve the complete settings and labels structure. Contact and pickup fields are managed in Site assets; legacy unmanaged labels are left unchanged.</p>
          <label className="admin-field">Site content JSON<textarea value={editor || pretty(data)} onChange={(event) => setEditor(event.target.value)} rows={25} spellCheck={false} /></label>
          <div className="admin-actions"><button className="button button-primary" type="submit" disabled={ownerChangePending} aria-busy={ownerChangePending}>{ownerChangePending && <span className="admin-request-spinner" aria-hidden="true" />}{ownerChangePending ? "Requesting approval…" : "Request owner approval"}</button><button className="button button-ghost" type="button" disabled={ownerChangePending} onClick={() => setEditor(pretty(data))}>Reset editor</button></div>
        </form>
        <section className="admin-card">
          <h2>Reset public site content</h2>
          <p>This restores public settings and page copy. Fleet, site assets, inquiries, chat sessions, and administrator access are unchanged. Owner approval is required.</p>
          <button className="button button-danger" type="button" disabled={ownerChangePending} aria-busy={ownerChangePending} onClick={() => {
            if (!window.confirm("Reset public settings and page copy to defaults? Fleet, site assets, booking inquiries, and chat sessions will remain unchanged.")) return;
            void requestOwnerChange({
              resource: "site_content",
              action: "update",
              data: {
                settings: defaultSiteContent.settings,
                labels: defaultSiteContent.labels,
                discountRules: defaultSiteContent.discountRules,
                socialLinks: defaultSiteContent.socialLinks,
              },
            });
          }}>{ownerChangePending && <span className="admin-request-spinner" aria-hidden="true" />}{ownerChangePending ? "Requesting approval…" : "Request reset to defaults"}</button>
        </section>
      </>
    );
  }

  function renderChat() {
    const sessions = records(data);
    return (
      <>
        <div className="admin-toolbar admin-fleet-toolbar">
          <div className="admin-fleet-count">
            <p>{sessions.length} chat sessions</p>
            <button
              className={`admin-fleet-refresh${loading ? " is-refreshing" : ""}`}
              type="button"
              aria-label="Refresh chat sessions"
              title="Refresh chat sessions"
              disabled={loading}
              onClick={() => void refresh()}
            >
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M20 7v5h-5M4 17v-5h5m-4.1-3A7.5 7.5 0 0 1 17.6 6L20 12M4 12l2.4 6a7.5 7.5 0 0 0 12.7-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
        {sessions.length ? sessions.map((session, index) => (
          <article className="admin-list-row" key={text(session.id, String(index))}>
            <div>
              <strong>{text(session.username ?? session.name, "Guest session")}</strong>
              <span>Session {text(session.id)}</span>
              <span>Started {date(session.started_at ?? session.created_at)} · Last activity {date(session.last_message_at ?? session.updated_at)}</span>
              <span>{Array.isArray(session.messages) ? `${session.messages.length} messages` : "Message count unavailable"}</span>
              {Array.isArray(session.messages) ? (
                <details className="admin-transcript">
                  <summary>View transcript</summary>
                  {session.messages.map((message, messageIndex) => (
                    <p key={messageIndex}><strong>{isRecord(message) ? text(message.role, "Message") : "Message"}:</strong> {isRecord(message) ? text(message.content ?? message.text) : text(message)}</p>
                  ))}
                </details>
              ) : null}
            </div>
            <button className="button button-danger" type="button" disabled={ownerChangePending} aria-busy={ownerChangePending} onClick={() => {
              if (window.confirm("Delete this chat session?")) {
                void requestOwnerChange({ resource: "chat_sessions", action: "delete", data: { id: session.id } });
              }
            }}>{ownerChangePending && <span className="admin-request-spinner" aria-hidden="true" />}{ownerChangePending ? "Requesting approval…" : "Delete"}</button>
          </article>
        )) : <p className="admin-empty">No chat sessions found.</p>}
      </>
    );
  }

  function renderAnalytics() {
    return (
      <section className="admin-card admin-maintenance" role="status">
        <p className="eyebrow">Analytics</p>
        <h2>Under maintenance</h2>
        <p>Analytics is being prepared and will be available here in a future update.</p>
      </section>
    );
  }

  const content = {
    inquiries: renderInquiries,
    fleet: renderFleet,
    assets: renderAssets,
    content: renderContent,
    chat: renderChat,
    analytics: renderAnalytics,
  }[tab]();
  const activeTab = tabs.find((item) => item.id === tab);

  return (
    <main className="admin-dashboard admin-shell visible">
      <aside className="admin-sidebar">
        <a className="logo" href="/">carTOGO.mnl</a>
        <p className="eyebrow">Admin workspace</p>
        <nav className="admin-nav admin-tabs" aria-label="Admin sections">
          {visibleTabs.map((item) => (
            <button className={item.id === tab ? "is-active" : ""} type="button" key={item.id} onClick={() => {
              window.sessionStorage.setItem("cartogo-admin-tab", item.id);
              setTab(item.id);
              void loadTab(item.id);
            }}>{item.label}</button>
          ))}
        </nav>
        <div className="admin-sidebar-footer">
          <span>{profile?.email ?? email}</span>
          <a href="/">View public site</a>
          <button type="button" onClick={onSignOut}>Sign out</button>
        </div>
      </aside>
      <section className="admin-main">
        <header className="admin-header">
          <div><p className="eyebrow">{profile?.titles.join(" · ") || "Administrator"}</p><h1>{activeTab?.label ?? "Admin"}</h1></div>
        </header>
        {rejectionPendingId !== null ? (
          <p className="admin-rejection-progress" role="status" aria-live="polite">
            <span className="admin-rejection-spinner" aria-hidden="true" />
            Rejecting inquiry #{rejectionPendingId} and notifying the customer…
          </p>
        ) : null}
        {notice ? <p className="admin-notice" role="status">{notice}</p> : null}
        {error ? <p className="admin-error" role="alert">{error}</p> : null}
        {approval ? (
          <form ref={approvalFormRef} className="admin-approval-card" onSubmit={(event) => void approveChange(event)}>
            <div><p className="eyebrow">Owner approval required</p><h2>Enter the six-digit PIN</h2><p>Sent to {approval.ownerEmail}. It expires in {Math.ceil(approval.expiresIn / 60)} minutes and can be used once.</p></div>
            <label className="admin-field">Approval PIN<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={approvalCode} onChange={(event) => setApprovalCodes((current) => ({ ...current, [tab]: event.target.value.replace(/\D/g, "").slice(0, 6) }))} /></label>
            <div className="admin-actions admin-approval-actions"><button className="button button-primary" type="submit" disabled={approvalPending}>{approvalPending ? "Applying…" : "Approve change"}</button><button className="button button-ghost" type="button" disabled={approvalPending} onClick={() => {
              setApprovals((current) => {
                const next = { ...current };
                delete next[tab];
                return next;
              });
              setApprovalCodes((current) => {
                const next = { ...current };
                delete next[tab];
                return next;
              });
            }}>Cancel</button></div>
          </form>
        ) : null}
        {loading ? <p className="admin-empty" role="status">Loading {activeTab?.label.toLowerCase()}…</p> : null}
        {!loading && !error ? content : null}
        {!loading && profile && visibleTabs.length === 0 ? <p className="admin-empty">Your account is authenticated, but no admin title currently grants dashboard access. Ask an Owner to assign a role.</p> : null}
      </section>
    </main>
  );
}
