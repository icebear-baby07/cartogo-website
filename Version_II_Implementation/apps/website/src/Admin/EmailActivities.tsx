import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from "react";

type Activity = {
  timestamp: string;
  email_type: string;
  activity: string;
  count: number;
};

type VehicleDemandItem = {
  vehicle_id: string;
  vehicle_name: string;
  inquiry_count: number;
};

type Range = { start: number; end: number };
type YRange = { min: number; max: number };
type ReportId = "email-activities" | "vehicle-demand";
type RequestAdmin = (path: string, init?: RequestInit) => Promise<unknown>;

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_RANGE_MS = DAY_MS;
const PLOT = { left: 68, top: 24, width: 850, height: 310 };
const ACTIVITY_TYPES = ["queued", "attempted", "sent", "failed"] as const;
const ACTIVITY_COLORS: Record<(typeof ACTIVITY_TYPES)[number], string> = {
  queued: "#64748b",
  attempted: "#2563eb",
  sent: "#15803d",
  failed: "#dc2626",
};
const EMAIL_TYPE_LABELS: Record<string, string> = {
  email_verification: "Email verification",
  inquiry_confirmation: "Inquiry confirmation",
  inquiry_rejection: "Inquiry rejection",
  owner_approval: "Owner approval",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseActivities(value: unknown): Activity[] {
  if (!Array.isArray(value)) throw new Error("The email activity response is invalid.");
  return value.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.timestamp !== "string" ||
      !Number.isFinite(Date.parse(item.timestamp)) ||
      typeof item.email_type !== "string" ||
      typeof item.activity !== "string" ||
      !Number.isSafeInteger(item.count) ||
      Number(item.count) < 0
    ) {
      throw new Error("The email activity response contains an invalid entry.");
    }
    return {
      timestamp: item.timestamp,
      email_type: item.email_type,
      activity: item.activity,
      count: Number(item.count),
    };
  });
}

function parseVehicleDemand(value: unknown): VehicleDemandItem[] {
  if (!Array.isArray(value)) throw new Error("The vehicle demand response is invalid.");
  return value.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.vehicle_id !== "string" ||
      typeof item.vehicle_name !== "string" ||
      !Number.isSafeInteger(item.inquiry_count) ||
      Number(item.inquiry_count) < 0
    ) {
      throw new Error("The vehicle demand response contains an invalid entry.");
    }
    return {
      vehicle_id: item.vehicle_id,
      vehicle_name: item.vehicle_name,
      inquiry_count: Number(item.inquiry_count),
    };
  });
}

function bucketMinutesForRange(range: Range): number {
  const desiredMinutes = (range.end - range.start) / 120 / 60_000;
  return Math.max(5, Math.ceil(desiredMinutes / 5) * 5);
}

function formatTick(timestamp: number, span: number): string {
  const options: Intl.DateTimeFormatOptions = span <= 2 * DAY_MS
    ? { month: "short", day: "numeric", hour: "numeric" }
    : { month: "short", day: "numeric" };
  return new Date(timestamp).toLocaleString(undefined, options);
}

function useZoomedRange(range: Range, factor: number, anchor = 0.5): Range {
  const span = range.end - range.start;
  const nextSpan = Math.max(MIN_RANGE_MS, span * factor);
  const anchorTime = range.start + span * anchor;
  return {
    start: anchorTime - nextSpan * anchor,
    end: anchorTime + nextSpan * (1 - anchor),
  };
}

export default function EmailActivities({ request }: { request: RequestAdmin }) {
  const [range, setRange] = useState<Range>(() => {
    const end = Date.now();
    return { start: end - 7 * DAY_MS, end };
  });
  const [yRange, setYRange] = useState<YRange>({ min: 0, max: 50 });
  const [activities, setActivities] = useState<Activity[]>([]);
  const [vehicleDemand, setVehicleDemand] = useState<VehicleDemandItem[]>([]);
  const [emailType, setEmailType] = useState("all");
  const [loading, setLoading] = useState(true);
  const [vehicleDemandLoading, setVehicleDemandLoading] = useState(true);
  const [error, setError] = useState("");
  const [vehicleDemandError, setVehicleDemandError] = useState("");
  const [hoveredVehicle, setHoveredVehicle] = useState<number | null>(null);
  const [emailRefreshVersion, setEmailRefreshVersion] = useState(0);
  const [vehicleDemandRefreshVersion, setVehicleDemandRefreshVersion] = useState(0);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [expandedReport, setExpandedReport] = useState<ReportId | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const emailReportRef = useRef<HTMLElement>(null);
  const vehicleDemandReportRef = useRef<HTMLElement>(null);
  const lastSelectedReport = useRef<ReportId | null>(null);
  const dragStart = useRef<{
    x: number;
    y: number;
    range: Range;
    yRange: YRange;
  } | null>(null);

  const bucketMinutes = bucketMinutesForRange(range);
  const bucketMilliseconds = bucketMinutes * 60_000;

  useEffect(() => {
    if (!expandedReport) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpandedReport(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [expandedReport]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const selectedReport = expandedReport ?? lastSelectedReport.current;
      if (!selectedReport) return;
      const report = selectedReport === "email-activities"
        ? emailReportRef.current
        : vehicleDemandReportRef.current;
      if (!report) return;

      const sidebar = document.querySelector<HTMLElement>(".admin-sidebar");
      const stickyOffset = window.matchMedia("(max-width: 820px)").matches
        ? (sidebar?.getBoundingClientRect().height ?? 0) + 12
        : 16;
      const top = report.getBoundingClientRect().top + window.scrollY - stickyOffset;
      window.scrollTo({
        top: Math.max(0, top),
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [expandedReport]);

  function toggleReport(report: ReportId) {
    lastSelectedReport.current = report;
    setExpandedReport((current) => current === report ? null : report);
  }

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({
      start: new Date(range.start).toISOString(),
      end: new Date(range.end).toISOString(),
      bucketMinutes: String(bucketMinutes),
    });
    const timeout = window.setTimeout(() => {
      setLoading(true);
      setError("");
      void request(`/api/admin/analytics/email-activities?${query}`, { signal: controller.signal })
        .then((result) => {
          if (!controller.signal.aborted) setActivities(parseActivities(result));
        })
        .catch((loadError: unknown) => {
          if (controller.signal.aborted) return;
          setError(loadError instanceof Error ? loadError.message : "Could not load email activity.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 180);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [bucketMinutes, emailRefreshVersion, range.end, range.start, request]);

  useEffect(() => {
    const controller = new AbortController();
    setVehicleDemandLoading(true);
    setVehicleDemandError("");
    void request("/api/admin/analytics/vehicle-demand", { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setVehicleDemand(parseVehicleDemand(result));
      })
      .catch((loadError: unknown) => {
        if (controller.signal.aborted) return;
        setVehicleDemandError(loadError instanceof Error ? loadError.message : "Could not load vehicle demand.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setVehicleDemandLoading(false);
      });
    return () => controller.abort();
  }, [request, vehicleDemandRefreshVersion]);

  const chartData = useMemo(() => {
    const startBucket = Math.floor(range.start / bucketMilliseconds) * bucketMilliseconds;
    const bucketCount = Math.ceil((range.end - startBucket) / bucketMilliseconds);
    const points = Array.from({ length: bucketCount }, (_, index) => ({
      timestamp: startBucket + index * bucketMilliseconds,
      queued: 0,
      attempted: 0,
      sent: 0,
      failed: 0,
    }));
    for (const activity of activities) {
      if (emailType !== "all" && activity.email_type !== emailType) continue;
      const timestamp = Date.parse(activity.timestamp);
      const index = Math.floor((timestamp - startBucket) / bucketMilliseconds);
      if (index >= 0 && index < points.length && ACTIVITY_TYPES.includes(activity.activity as typeof ACTIVITY_TYPES[number])) {
        points[index][activity.activity as typeof ACTIVITY_TYPES[number]] += activity.count;
      }
    }
    return points.filter((point) => point.timestamp < range.end);
  }, [activities, bucketMilliseconds, emailType, range.end, range.start]);

  const totalActivities = chartData.reduce(
    (total, point) => total + point.queued + point.attempted + point.sent + point.failed,
    0,
  );
  const activityByEmailType = useMemo(() => {
    const summary = new Map<string, Record<(typeof ACTIVITY_TYPES)[number], number>>();
    for (const activity of activities) {
      const timestamp = Date.parse(activity.timestamp);
      if (timestamp < range.start || timestamp >= range.end) continue;
      if (emailType !== "all" && activity.email_type !== emailType) continue;
      if (!ACTIVITY_TYPES.includes(activity.activity as (typeof ACTIVITY_TYPES)[number])) continue;
      const typeSummary = summary.get(activity.email_type) ?? {
        queued: 0,
        attempted: 0,
        sent: 0,
        failed: 0,
      };
      typeSummary[activity.activity as (typeof ACTIVITY_TYPES)[number]] += activity.count;
      summary.set(activity.email_type, typeSummary);
    }
    return [...summary.entries()].sort((left, right) =>
      right[1].sent - left[1].sent || left[0].localeCompare(right[0]),
    );
  }, [activities, emailType, range.end, range.start]);
  const maxVehicleDemand = Math.max(1, ...vehicleDemand.map((item) => item.inquiry_count));
  const ySpan = yRange.max - yRange.min;
  const yStep = 25;
  const yTicks = useMemo(() => {
    const ticks = new Set<number>();
    for (let value = Math.ceil(yRange.min / yStep) * yStep; value <= yRange.max; value += yStep) {
      ticks.add(value);
    }
    if (yRange.min <= 50 && yRange.max >= 50) ticks.add(50);
    return [...ticks].sort((left, right) => left - right);
  }, [yRange.max, yRange.min, yStep]);
  const y = (value: number) => PLOT.top + (yRange.max - value) / ySpan * PLOT.height;
  const x = (timestamp: number) =>
    PLOT.left + (timestamp - range.start) / (range.end - range.start) * PLOT.width;
  const hoveredCandidate = hoveredIndex === null ? null : chartData[hoveredIndex] ?? null;
  const hoveredPoint = hoveredCandidate && ACTIVITY_TYPES.some((activity) => hoveredCandidate[activity] > 0)
    ? hoveredCandidate
    : null;
  const hoveredActivities = hoveredPoint
    ? ACTIVITY_TYPES.filter((activity) => hoveredPoint[activity] > 0)
    : [];
  const hoveredPeak = hoveredPoint
    ? Math.max(...hoveredActivities.map((activity) => hoveredPoint[activity]))
    : 0;
  const hoveredPeakY = y(hoveredPeak);
  const tooltipAtBottom = Boolean(hoveredPoint && hoveredPeakY < PLOT.top + 72);
  const tooltipOnLeft = Boolean(hoveredPoint && x(hoveredPoint.timestamp) / 960 > 0.55);

  function pathFor(activity: (typeof ACTIVITY_TYPES)[number]): string {
    return chartData.map((point, index) =>
      `${index === 0 ? "M" : "L"}${x(point.timestamp).toFixed(2)},${y(point[activity]).toFixed(2)}`,
    ).join(" ");
  }

  function zoomTime(factor: number, anchor = 0.5) {
    setRange((current) => useZoomedRange(current, factor, anchor));
  }

  function zoomCount(factor: number) {
    setYRange((current) => {
      const center = (current.min + current.max) / 2;
      const nextSpan = Math.max(25, (current.max - current.min) * factor);
      const min = center - nextSpan / 2;
      const max = center + nextSpan / 2;
      return min < 0 ? { min: 0, max: nextSpan } : { min, max };
    });
  }

  function onPointerDown(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStart.current = {
      x: event.clientX,
      y: event.clientY,
      range,
      yRange,
    };
  }

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    const start = dragStart.current;
    const bounds = svgRef.current?.getBoundingClientRect();
    if (!bounds || !bounds.width || !bounds.height) return;
    if (start) {
      setHoveredIndex(null);
      const deltaTime = (event.clientX - start.x) / bounds.width * (start.range.end - start.range.start);
      const deltaCount = (start.y - event.clientY) / bounds.height * (start.yRange.max - start.yRange.min);
      setRange({
        start: start.range.start - deltaTime,
        end: start.range.end - deltaTime,
      });
      setYRange(() => {
        const shift = Math.max(-start.yRange.min, deltaCount);
        return { min: start.yRange.min + shift, max: start.yRange.max + shift };
      });
      return;
    }

    const pointerX = (event.clientX - bounds.left) / bounds.width * 960;
    if (pointerX < PLOT.left || pointerX > PLOT.left + PLOT.width || !chartData.length) {
      setHoveredIndex(null);
      return;
    }
    const pointerTime = range.start + (pointerX - PLOT.left) / PLOT.width * (range.end - range.start);
    const index = Math.round((pointerTime - chartData[0].timestamp) / bucketMilliseconds);
    setHoveredIndex(Math.max(0, Math.min(chartData.length - 1, index)));
  }

  function resetRange() {
    setHoveredIndex(null);
    const end = Date.now();
    setRange({ start: end - 7 * DAY_MS, end });
    setYRange({ min: 0, max: 50 });
  }

  function refreshLatest() {
    setHoveredIndex(null);
    const end = Date.now();
    setRange((current) => {
      const span = current.end - current.start;
      return { start: end - span, end };
    });
    setEmailRefreshVersion((version) => version + 1);
  }

  return (
    <section className="admin-analytics-grid" aria-label="Analytics reports">
      <article
        ref={emailReportRef}
        className={`admin-card admin-analytics-report admin-email-report${expandedReport === "email-activities" ? " is-expanded" : ""}${expandedReport && expandedReport !== "email-activities" ? " is-minimized" : ""}`}
      >
        <div className="admin-analytics-heading">
          <div>
            <p className="eyebrow">Email health</p>
            <h2>Email Activities</h2>
            <p>{totalActivities > 2 ? "2+" : totalActivities} recorded email activities in this view</p>
          </div>
          <div className="admin-analytics-heading-actions admin-analytics-email-actions">
            <label className="admin-analytics-filter">
              Email type
              <select value={emailType} onChange={(event) => setEmailType(event.target.value)}>
                <option value="all">All email types</option>
                {Object.entries(EMAIL_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <button
              className="admin-analytics-icon-button"
              type="button"
              aria-label={expandedReport === "email-activities" ? "Minimize Email Activities" : "Expand Email Activities to full screen"}
              title={expandedReport === "email-activities" ? "Minimize" : "Full screen"}
              aria-expanded={expandedReport === "email-activities"}
              aria-controls="email-activities-report-content"
              onClick={() => toggleReport("email-activities")}
            >
              {expandedReport === "email-activities" ? (
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M8 3v5H3m13-5v5h5M8 21v-5H3m13 5v-5h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          </div>
        </div>
        <div id="email-activities-report-content">
        <div className="admin-analytics-controls" aria-label="Chart controls">
          <div className="admin-analytics-control-group">
            <span>Time</span>
            <button type="button" aria-label="Zoom time in" onClick={() => zoomTime(0.7)}>+</button>
            <button type="button" aria-label="Zoom time out" onClick={() => zoomTime(1.4)}>−</button>
          </div>
          <div className="admin-analytics-control-group">
            <span>Count</span>
            <button type="button" aria-label="Zoom count in" onClick={() => zoomCount(0.5)}>+</button>
            <button type="button" aria-label="Zoom count out" onClick={() => zoomCount(2)}>−</button>
          </div>
          <button className="button button-ghost" type="button" onClick={resetRange}>Reset to 7 days</button>
          <button
            className={`admin-fleet-refresh${loading ? " is-refreshing" : ""}`}
            type="button"
            aria-label={loading ? "Refreshing email activities" : "Refresh email activities"}
            title={loading ? "Refreshing…" : "Refresh"}
            disabled={loading}
            onClick={refreshLatest}
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M20 7v5h-5M4 17v-5h5m-4.1-3A7.5 7.5 0 0 1 17.6 6L20 12M4 12l2.4 6a7.5 7.5 0 0 0 12.7-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <span className="admin-analytics-range" aria-live="polite">
            {new Date(range.start).toLocaleString()} — {new Date(range.end).toLocaleString()}
          </span>
        </div>
        {error ? <p className="admin-analytics-error" role="alert">{error}</p> : null}
        <div className={`admin-email-chart${loading ? " is-loading" : ""}`}>
          {hoveredPoint ? (
            <div
              className="admin-email-chart-tooltip"
              role="status"
              aria-live="polite"
              style={{
                left: `${x(hoveredPoint.timestamp) / 960 * 100}%`,
                top: `${(tooltipAtBottom ? PLOT.top + PLOT.height - 4 : hoveredPeakY) / 400 * 100}%`,
                transform: `translate(${tooltipOnLeft ? "calc(-100% - 8px)" : "8px"}, -50%)`,
              }}
            >
              <strong>
                {new Date(hoveredPoint.timestamp).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </strong>
              <span className="admin-email-chart-tooltip-data">
                {hoveredActivities.map((activity) => (
                  <span key={activity}>
                    <i style={{ backgroundColor: ACTIVITY_COLORS[activity] }} />
                    {activity[0].toUpperCase() + activity.slice(1)} {hoveredPoint[activity]}
                  </span>
                ))}
              </span>
            </div>
          ) : null}
          <svg
            ref={svgRef}
            viewBox="0 0 960 400"
            role="img"
            aria-label="Line chart of queued, attempted, sent, and failed email activity over time"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={() => { dragStart.current = null; }}
            onPointerCancel={() => { dragStart.current = null; }}
            onPointerLeave={() => {
              if (!dragStart.current) setHoveredIndex(null);
            }}
            onWheel={(event) => {
              event.preventDefault();
              const bounds = event.currentTarget.getBoundingClientRect();
              const anchor = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
              zoomTime(event.deltaY < 0 ? 0.8 : 1.25, anchor);
            }}
          >
            <defs>
              <clipPath id="email-chart-clip">
                <rect x={PLOT.left} y={PLOT.top} width={PLOT.width} height={PLOT.height} />
              </clipPath>
            </defs>
            {yTicks.map((tick) => (
              <g key={tick}>
                <line
                  x1={PLOT.left}
                  x2={PLOT.left + PLOT.width}
                  y1={y(tick)}
                  y2={y(tick)}
                  className={tick === 25 && yRange.min === 0 && yRange.max === 50 ? "admin-email-chart-midline" : "admin-email-chart-grid"}
                />
                <text x={PLOT.left - 12} y={y(tick) + 5} textAnchor="end" className="admin-email-chart-label">
                  {tick}
                </text>
              </g>
            ))}
            {Array.from({ length: 7 }, (_, index) => {
              const timestamp = range.start + (range.end - range.start) * index / 6;
              return (
                <g key={index}>
                  <line
                    x1={x(timestamp)}
                    x2={x(timestamp)}
                    y1={PLOT.top}
                    y2={PLOT.top + PLOT.height}
                    className="admin-email-chart-grid"
                  />
                  <text
                    x={x(timestamp)}
                    y={PLOT.top + PLOT.height + 28}
                    textAnchor="middle"
                    className="admin-email-chart-label"
                  >
                    {formatTick(timestamp, range.end - range.start)}
                  </text>
                </g>
              );
            })}
            <text
              x={18}
              y={PLOT.top + PLOT.height / 2}
              textAnchor="middle"
              transform={`rotate(-90 18 ${PLOT.top + PLOT.height / 2})`}
              className="admin-email-chart-axis-title"
            >
              Email activity count
            </text>
            <text
              x={PLOT.left + PLOT.width / 2}
              y={PLOT.top + PLOT.height + 55}
              textAnchor="middle"
              className="admin-email-chart-axis-title"
            >
              Time
            </text>
            <g clipPath="url(#email-chart-clip)">
              {hoveredPoint ? (
                <line
                  x1={x(hoveredPoint.timestamp)}
                  x2={x(hoveredPoint.timestamp)}
                  y1={PLOT.top}
                  y2={PLOT.top + PLOT.height}
                  className="admin-email-chart-hover-line"
                />
              ) : null}
              {ACTIVITY_TYPES.map((activity) => (
                <g key={activity}>
                  <path
                    d={pathFor(activity)}
                    fill="none"
                    stroke={ACTIVITY_COLORS[activity]}
                    strokeWidth="2.5"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                  {hoveredPoint ? (
                    <circle
                      cx={x(hoveredPoint.timestamp)}
                      cy={y(hoveredPoint[activity])}
                      r="5"
                      fill={ACTIVITY_COLORS[activity]}
                      stroke="white"
                      strokeWidth="2"
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : null}
                </g>
              ))}
            </g>
          </svg>
        </div>
        <div className="admin-email-chart-legend" aria-label="Email activity series">
          {ACTIVITY_TYPES.map((activity) => (
            <span key={activity}>
              <i style={{ backgroundColor: ACTIVITY_COLORS[activity] }} aria-hidden="true" />
              {activity[0].toUpperCase() + activity.slice(1)}
            </span>
          ))}
        </div>
        {expandedReport === "email-activities" ? (
          <section className="admin-analytics-details" aria-label="Email activity details">
            <h3>Activity breakdown by email type</h3>
            {activityByEmailType.length ? (
              <div className="admin-analytics-table-wrap">
                <table className="admin-analytics-table">
                  <thead><tr><th>Email type</th><th>Queued</th><th>Attempted</th><th>Sent</th><th>Failed</th><th>Total events</th></tr></thead>
                  <tbody>
                    {activityByEmailType.map(([type, counts]) => (
                      <tr key={type}>
                        <th scope="row">{EMAIL_TYPE_LABELS[type] ?? type}</th>
                        <td>{counts.queued}</td>
                        <td>{counts.attempted}</td>
                        <td>{counts.sent}</td>
                        <td>{counts.failed}</td>
                        <td>{counts.queued + counts.attempted + counts.sent + counts.failed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p>No email activity is recorded for this time range.</p>}
            <p>Each row counts lifecycle events, so one email can contribute multiple events (for example, attempted and sent).</p>
          </section>
        ) : null}
        <p className="admin-analytics-hint">
          Drag to pan the time and count axes; use the controls or mouse wheel to zoom time. “Sent” means accepted by the SMTP server, not confirmed in the recipient&apos;s inbox. Activity history begins when tracking is enabled.
        </p>
        </div>
      </article>
      <article
        ref={vehicleDemandReportRef}
        className={`admin-card admin-analytics-report admin-vehicle-demand${expandedReport === "vehicle-demand" ? " is-expanded" : ""}${expandedReport && expandedReport !== "vehicle-demand" ? " is-minimized" : ""}`}
      >
        <div className="admin-analytics-heading">
          <div>
            <p className="eyebrow">Fleet interest</p>
            <h2>Vehicle on Demand</h2>
            <p>Top vehicles requested in booking inquiries</p>
          </div>
          <div className="admin-analytics-heading-actions admin-analytics-heading-buttons">
            <button
              className={`admin-fleet-refresh${vehicleDemandLoading ? " is-refreshing" : ""}`}
              type="button"
              aria-label={vehicleDemandLoading ? "Refreshing vehicle demand" : "Refresh vehicle demand"}
              title={vehicleDemandLoading ? "Refreshing…" : "Refresh"}
              disabled={vehicleDemandLoading}
              onClick={() => setVehicleDemandRefreshVersion((version) => version + 1)}
            >
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M20 7v5h-5M4 17v-5h5m-4.1-3A7.5 7.5 0 0 1 17.6 6L20 12M4 12l2.4 6a7.5 7.5 0 0 0 12.7-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              className="admin-analytics-icon-button"
              type="button"
              aria-label={expandedReport === "vehicle-demand" ? "Minimize Vehicle on Demand" : "Expand Vehicle on Demand to full screen"}
              title={expandedReport === "vehicle-demand" ? "Minimize" : "Full screen"}
              aria-expanded={expandedReport === "vehicle-demand"}
              aria-controls="vehicle-demand-report-content"
              onClick={() => toggleReport("vehicle-demand")}
            >
              {expandedReport === "vehicle-demand" ? (
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M8 3v5H3m13-5v5h5M8 21v-5H3m13 5v-5h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          </div>
        </div>
        <div id="vehicle-demand-report-content">
        {vehicleDemandError ? <p className="admin-analytics-error" role="alert">{vehicleDemandError}</p> : null}
        {vehicleDemandLoading ? (
          <p className="admin-empty" role="status">Loading vehicle demand…</p>
        ) : vehicleDemand.length ? (
          <div className="admin-vehicle-demand-chart">
            {hoveredVehicle !== null && vehicleDemand[hoveredVehicle] ? (
              <div className="admin-vehicle-demand-tooltip" role="status" aria-live="polite">
                <strong>{vehicleDemand[hoveredVehicle].vehicle_name}</strong>
                <span>{vehicleDemand[hoveredVehicle].inquiry_count} {vehicleDemand[hoveredVehicle].inquiry_count === 1 ? "inquiry" : "inquiries"}</span>
              </div>
            ) : null}
            <svg
              viewBox={`0 0 600 ${Math.max(150, vehicleDemand.length * 38 + 32)}`}
              role="img"
              aria-label="Horizontal bar chart of vehicles ranked by inquiry count"
            >
              {vehicleDemand.map((item, index) => {
                const rowY = 16 + index * 38;
                const barWidth = item.inquiry_count / maxVehicleDemand * 365;
                return (
                  <g
                    key={`${item.vehicle_id}-${item.vehicle_name}`}
                    className="admin-vehicle-demand-row"
                    tabIndex={0}
                    role="img"
                    aria-label={`${item.vehicle_name}: ${item.inquiry_count} ${item.inquiry_count === 1 ? "inquiry" : "inquiries"}`}
                    onMouseEnter={() => setHoveredVehicle(index)}
                    onMouseLeave={() => setHoveredVehicle(null)}
                    onFocus={() => setHoveredVehicle(index)}
                    onBlur={() => setHoveredVehicle(null)}
                  >
                    <text x="0" y={rowY + 17} className="admin-vehicle-demand-label">
                      {item.vehicle_name.length > 18 ? `${item.vehicle_name.slice(0, 17)}…` : item.vehicle_name}
                    </text>
                    <rect
                      x="170"
                      y={rowY}
                      width="365"
                      height="25"
                      rx="4"
                      className="admin-vehicle-demand-track"
                    />
                    <rect
                      x="170"
                      y={rowY}
                      width={barWidth}
                      height="25"
                      rx="4"
                      className={`admin-vehicle-demand-bar${hoveredVehicle === index ? " is-hovered" : ""}`}
                    />
                    <text x={Math.min(570, 180 + barWidth)} y={rowY + 17} className="admin-vehicle-demand-count">
                      {item.inquiry_count}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        ) : (
          <p className="admin-empty">No vehicle inquiries yet.</p>
        )}
        {expandedReport === "vehicle-demand" ? (
          <section className="admin-analytics-details" aria-label="Vehicle demand details">
            <h3>Vehicle inquiry details</h3>
            {vehicleDemand.length ? (
              <div className="admin-analytics-table-wrap">
                <table className="admin-analytics-table">
                  <thead><tr><th>Rank</th><th>Vehicle</th><th>Inquiry count</th><th>Share of top 10</th></tr></thead>
                  <tbody>
                    {vehicleDemand.map((item, index) => {
                      const totalTopTen = vehicleDemand.reduce((total, vehicle) => total + vehicle.inquiry_count, 0);
                      const share = totalTopTen ? item.inquiry_count / totalTopTen * 100 : 0;
                      return (
                        <tr key={`${item.vehicle_id}-${item.vehicle_name}`}>
                          <td>{index + 1}</td>
                          <th scope="row">{item.vehicle_name}</th>
                          <td>{item.inquiry_count}</td>
                          <td>{share.toFixed(1)}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : <p>No vehicle inquiries yet.</p>}
            <p>Demand is based on submitted inquiries and does not indicate confirmed or paid rentals.</p>
          </section>
        ) : null}
        <p className="admin-analytics-hint">Hover or focus a bar to see its inquiry count.</p>
        </div>
      </article>
    </section>
  );
}
