import { lazy, Suspense, useEffect, useState } from "react";
import type {
  PublicUnit,
  SiteAsset,
  SiteContent,
} from "@cartogo/contracts";
import ChatWidget from "./ChatWidget";
import BookingForm from "./BookingForm";

const PickupMap = lazy(() => import("./PickupMap"));

type PublicSiteProps = {
  units: PublicUnit[];
  assets: SiteAsset[];
  content: SiteContent;
};

const vehicleImages: Record<string, string> = {
  "honda city": "/images/honda-city-red.jpg",
  "mitsubishi mirage g4": "/images/mirage-g4-red.jpg",
  "mirage g4": "/images/mirage-g4-red.jpg",
  "toyota fortuner": "/images/toyota-fortuner.jpg",
};

function imageForUnit(unit: PublicUnit): string {
  const modelKey = `${unit.brand} ${unit.model}`.trim().toLowerCase();
  return vehicleImages[modelKey] ?? "/images/cartogo-fleet.jpg";
}

function formatCurrency(value: number, currency: string): string {
  return `${currency}${new Intl.NumberFormat("en-PH", {
    maximumFractionDigits: 0,
  }).format(value)}`;
}

function inlineEmphasis(value: string) {
  const pieces = value.split(/<em>(.*?)<\/em>/gi);
  return pieces.map((piece, index) =>
    index % 2 === 1 ? <em key={index}>{piece}</em> : piece,
  );
}

function isLocation(asset: SiteAsset): asset is Extract<SiteAsset, { asset_type: "location" }> {
  return asset.asset_type === "location";
}

function isContact(asset: SiteAsset): asset is Extract<SiteAsset, { asset_type: "contact" }> {
  return asset.asset_type === "contact";
}

export default function PublicSite({ units, assets, content }: PublicSiteProps) {
  const { settings, labels } = content;
  const locations = assets.filter(isLocation);
  const contact = assets.find(isContact);
  const categories = ["All", ...new Set(units.map((unit) => unit.brand))];
  const [activeCategory, setActiveCategory] = useState("All");
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedBookingUnit, setSelectedBookingUnit] = useState("");
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [googleAccountSignedIn, setGoogleAccountSignedIn] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [pauseSlides, setPauseSlides] = useState(false);

  useEffect(() => {
    document.title = `${settings.companyName} — Car Rentals`;
  }, [settings.companyName]);

  const visibleUnits =
    activeCategory === "All"
      ? units
      : units.filter((unit) => unit.brand === activeCategory);
  const availableCount = units.filter((unit) => unit.status === "Available").length;
  const about = labels.about;
  const howItWorks = labels.howItWorks.some((step) =>
    step.title.trim().toLowerCase() === "return the vehicle",
  )
    ? labels.howItWorks
    : [...labels.howItWorks, {
      title: "Return the vehicle",
      description: "Bring the car back at the agreed time and place. Contact our team in advance if you need to request a change.",
    }];

  useEffect(() => {
    if (pauseSlides || howItWorks.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      setActiveStep((current) => (current + 1) % howItWorks.length);
    }, 7000);
    return () => window.clearInterval(timer);
  }, [howItWorks.length, pauseSlides]);

  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <div className="topbar">Reliable cars · Easy booking · Flexible pickup across Metro Manila</div>
      <div className="kerb-strip" aria-hidden="true" />
      <header className={`site-header${menuOpen ? " open" : ""}`} id="siteHeader">
        <div className="wrap header-inner">
          <a className="logo" href="#top" aria-label={`${settings.companyName} home`}>
            {settings.companyName}
          </a>
          <nav
            className="nav-links"
            id="primary-nav"
            aria-label="Primary"
          >
            {[
              ["Fleet", "#fleet"],
              ["How it works", "#how"],
              ["Rates", "#rates"],
              ["FAQ", "#faq"],
              ["Contact", "#contact"],
            ].map(([label, href]) => (
              <a href={href} key={href} onClick={() => setMenuOpen(false)}>{label}</a>
            ))}
            <a className="button button-primary button-small mobile-nav-cta" href="#booking" onClick={() => setMenuOpen(false)}>
              Reserve a car
            </a>
          </nav>
          <div className="header-actions">
            <button
              className={`header-account${googleAccountSignedIn ? " is-signed-in" : ""}`}
              type="button"
              aria-label={googleAccountSignedIn ? "View signed-in account details" : "View account details"}
              aria-haspopup="dialog"
              aria-controls="accountDialog"
              title={googleAccountSignedIn ? "Account" : "View account details"}
              onClick={() => setAccountDialogOpen(true)}
            >
              <i className="fa-regular fa-user" aria-hidden="true" />
            </button>
            <a className="button button-primary button-small" href="#booking">Reserve a car</a>
            <button
              className="nav-toggle"
              type="button"
              aria-expanded={menuOpen}
              aria-controls="primary-nav"
              aria-label="Toggle navigation menu"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <span />
              <span />
              <span />
            </button>
          </div>
        </div>
      </header>

      <main id="main">
        <section className="hero" id="top">
          <div className="wrap hero-grid">
            <div className="hero-copy">
              <p className="eyebrow">Book in minutes · Drive in hours</p>
              <h1>{inlineEmphasis(labels.hero.title)}</h1>
              <p className="hero-sub">{labels.hero.subtitle}</p>
              <div className="hero-cta-row">
                <a className="button button-primary" href="#fleet">Browse the fleet</a>
                <a className="button button-ghost on-dark" href="#how">How it works</a>
              </div>
            </div>
            <div className="hero-art">
              <img src="/images/main-picture.jpg" alt="carTOGO rental cars ready for your trip" />
            </div>
          </div>
          <div className="road" aria-hidden="true" />
        </section>

        <div className="wrap trust-wrap">
          <div className="trust-strip hero-shortcuts" aria-label="Rental highlights">
            <a className="hero-shortcut" href="#fleet"><strong>{units.length}</strong><span>Cars in our fleet</span></a>
            <a className="hero-shortcut" href="#fleet"><strong>{categories.length - 1}</strong><span>Vehicle options</span></a>
            <a className="hero-shortcut" href="#contact"><strong>{locations.length || "Metro Manila"}</strong><span>Pickup areas</span></a>
            <a className="hero-shortcut" href="#booking"><strong>{availableCount}</strong><span>Currently available</span></a>
          </div>
        </div>

        <section className="section" id="fleet">
          <div className="wrap">
            <SectionHeading eyebrow="Our fleet" title="Choose the right car for your trip">
              Choose from our available vehicles and contact our team to check dates.
            </SectionHeading>
            <div className="filter-row" role="group" aria-label="Filter vehicles by brand">
              {categories.map((category) => (
                <button
                  type="button"
                  className={`filter-button${activeCategory === category ? " is-active" : ""}`}
                  aria-pressed={activeCategory === category}
                  key={category}
                  onClick={() => setActiveCategory(category)}
                >
                  {category}
                </button>
              ))}
            </div>
            {visibleUnits.length ? (
              <div className="fleet-grid">
                {visibleUnits.map((unit) => (
                  <article className="vehicle-card car-card" key={unit.id}>
                    <div className="vehicle-image car-media">
                      <img src={imageForUnit(unit)} alt={`${unit.display_name} rental vehicle`} loading="lazy" />
                      <span className="vehicle-category tag">{unit.brand}</span>
                      <span className={`availability avail${unit.status === "Available" ? "" : " out"}`}>
                        {unit.status}
                      </span>
                    </div>
                    <div className="vehicle-body car-body">
                      <h3>{unit.display_name}</h3>
                      <div className="vehicle-specs">
                        <span>{unit.capacity} seats</span>
                        <span>{unit.model}</span>
                        {unit.features.map((feature) => <span key={feature}>{feature}</span>)}
                      </div>
                      <p>{unit.features.length ? "Unit features listed above." : "Contact us for vehicle details."}</p>
                      <a
                        className="button button-dark button-small"
                        href="#booking"
                        onClick={() => setSelectedBookingUnit(String(unit.id))}
                      >
                        {unit.status === "Available" ? "Ask about this car" : "Ask about availability"}
                      </a>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="empty-state">No vehicles are listed in this category right now.</p>
            )}
          </div>
        </section>

        <section className="section bg-paper" id="how">
          <div className="wrap">
            <SectionHeading eyebrow="Simple steps, no surprises" title="How renting with us works" centered />
            <div
              className="how-slideshow"
              role="region"
              aria-roledescription="carousel"
              aria-label="Rental procedure"
              onPointerEnter={() => setPauseSlides(true)}
              onPointerLeave={() => setPauseSlides(false)}
              onFocusCapture={() => setPauseSlides(true)}
              onBlurCapture={(event) => {
                if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
                  setPauseSlides(false);
                }
              }}
            >
              <div className="how-slideshow-stage" aria-live="polite">
                {howItWorks.map((step, index) => (
                  <article
                    className={`marker how-slide${index === activeStep ? " is-active" : ""}`}
                    key={`${step.title}-${index}`}
                    role="group"
                    aria-roledescription="slide"
                    aria-label={`Step ${index + 1} of ${howItWorks.length}`}
                    aria-hidden={index !== activeStep}
                    inert={index !== activeStep}
                  >
                    <div className="num">{String(index + 1).padStart(2, "0")}</div>
                    <p className="how-slide-count">Step {index + 1} of {howItWorks.length}</p>
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </article>
                ))}
              </div>
              <div className="how-slideshow-controls">
                <button className="how-slide-control" type="button" aria-label="Previous step" onClick={() => setActiveStep((current) => (current - 1 + howItWorks.length) % howItWorks.length)}>
                  <i className="fa-solid fa-arrow-left" aria-hidden="true" />
                </button>
                <div className="how-slide-indicators" role="group" aria-label="Choose a rental procedure step">
                  {howItWorks.map((step, index) => (
                    <button
                      className="how-slide-indicator"
                      type="button"
                      key={`${step.title}-${index}`}
                      aria-label={`Go to step ${index + 1}: ${step.title}`}
                      aria-pressed={index === activeStep}
                      onClick={() => setActiveStep(index)}
                    ><span aria-hidden="true" /></button>
                  ))}
                </div>
                <button className="how-slide-control" type="button" aria-label="Next step" onClick={() => setActiveStep((current) => (current + 1) % howItWorks.length)}>
                  <i className="fa-solid fa-arrow-right" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="section bg-dark">
          <div className="wrap">
            <SectionHeading eyebrow="Why carTOGO" title="A smoother way to get moving" />
            <div className="why-grid">
              {labels.whyChooseUs.map((item, index) => (
                <article className="why-item" key={`${item.title}-${index}`}>
                  <span className="icon"><i className={`fa-solid ${iconClass(item.icon)}`} aria-hidden="true" /></span>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="section bg-paper" id="rates">
          <div className="wrap">
            <SectionHeading eyebrow="Pricing" title="Rates & deposits">
              Rates vary by vehicle and destination. Long rentals may qualify for the listed discount.
            </SectionHeading>
            <div className="rates-table-wrap rates-scroll">
              <table className="rates rates-table">
                <thead>
                  <tr>
                    <th scope="col">Vehicle</th>
                    <th scope="col">Brand</th>
                    <th scope="col">Metro Manila · 12 hr</th>
                    <th scope="col">Metro Manila · 24 hr</th>
                    <th scope="col">Nearby · 12 hr</th>
                    <th scope="col">Nearby · 24 hr</th>
                    <th scope="col">Luzon · 24 hr</th>
                  </tr>
                </thead>
                <tbody>
                  {units.map((unit) => (
                    <tr key={unit.id}>
                      <th scope="row">{unit.display_name}</th>
                      <td>{unit.brand}</td>
                      <td>{formatCurrency(unit.in12_rate, settings.currency)}</td>
                      <td>{formatCurrency(unit.in24_rate, settings.currency)}</td>
                      <td>{formatCurrency(unit.out12_rate, settings.currency)}</td>
                      <td>{formatCurrency(unit.out24_rate, settings.currency)}</td>
                      <td>{formatCurrency(unit.luzon_rate, settings.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="fees-note fee-grid">
              <Fee label="Extra driver / trip" value={settings.extraDriverFee} currency={settings.currency} detail="A per-trip charge for adding an authorized driver." />
              <Fee label="Child seat / trip" value={settings.childSeatFee} currency={settings.currency} detail="Request a child seat with your booking inquiry." />
              <Fee label="Late return / hour" value={settings.lateFeePerHour} currency={settings.currency} detail="Charged for each hour past the scheduled return time." />
              <Fee label="Refundable deposit" value={settings.depositPercent} currency="%" detail="The displayed percentage is an estimate of the refundable deposit." />
            </div>
            {content.discountRules.length > 0 && (
              <p className="discount-note">
                {content.discountRules.map((rule) =>
                  `${rule.percent}% off ${rule.minDays}–${rule.maxDays} days`,
                ).join(" · ")}
              </p>
            )}
          </div>
        </section>

        <section className="section">
          <div className="wrap">
            <SectionHeading eyebrow="A few words about the fleet" title="Road-ready for every kind of trip" />
            <div className="testi-grid testimonial-grid">
              {labels.testimonials.map((item, index) => (
                <blockquote className="testi-card testimonial-card" key={`${item.name}-${index}`}>
                  <span className="quote-mark quote" aria-hidden="true">“</span>
                  <p>{item.quote}</p>
                  <footer className="who"><strong>{item.name}</strong><span>{item.detail}</span></footer>
                </blockquote>
              ))}
            </div>
          </div>
        </section>

        <section className="section bg-paper" id="faq">
          <div className="wrap faq-layout">
            <SectionHeading eyebrow="Good to know" title="Frequently asked questions">
              Need more details? Contact our team and we’ll be happy to help.
            </SectionHeading>
            <div className="faq-list">
              {labels.faq.map((item, index) => (
                <details className="faq-item" key={`${item.q}-${index}`}>
                  <summary>{item.q}<span aria-hidden="true">+</span></summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <BookingForm
          units={units}
          content={content}
          selectedUnitId={selectedBookingUnit}
          onUnitChange={setSelectedBookingUnit}
          accountDialogOpen={accountDialogOpen}
          onAccountDialogOpenChange={setAccountDialogOpen}
          onGoogleAuthChange={setGoogleAccountSignedIn}
        />

        <section className="section bg-paper" id="contact">
          <div className="wrap">
            <SectionHeading eyebrow="Ready when you are" title="Talk to a live agent">
              Ask about vehicle availability, pickup, and booking details. No payment is taken online.
            </SectionHeading>
            <div className="contact-grid">
              <div className="contact-info-column">
                <article className={`contact-card live-agent-card${contact?.status === "closed" ? " is-closed" : ""}`}>
                  <div className="contact-card-heading">
                    <h3>{contact?.display_name || "Live agent"}</h3>
                    {contact && <span className={`contact-status${contact.status === "closed" ? " is-closed" : ""}`}>{contact.status === "closed" ? "Closed" : "Open"}</span>}
                  </div>
                  {contact?.description && <p className="contact-description">{contact.description}</p>}
                  {contact?.phone && (
                    <div className="contact-channel"><i className="fa-solid fa-phone" aria-hidden="true" /><div><span>Phone</span><a href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`}>{contact.phone}</a></div></div>
                  )}
                  {contact?.email && (
                    <div className="contact-channel"><i className="fa-solid fa-envelope" aria-hidden="true" /><div><span>Email</span><a href={`mailto:${contact.email}`}>{contact.email}</a></div></div>
                  )}
                  {contact?.operational_hours && (
                    <div className="contact-channel"><i className="fa-regular fa-clock" aria-hidden="true" /><div><span>Operational hours</span><p>{contact.operational_hours}</p></div></div>
                  )}
                  <div className="contact-actions">
                    {contact?.phone && <a className="button button-primary button-small" href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`}>Call our team</a>}
                    {contact?.email && <a className="button button-ghost button-small" href={`mailto:${contact.email}`}>Email us</a>}
                  </div>
                </article>
                <article className="contact-card">
                  <h3>Pickup locations</h3>
                  {locations.length ? (
                    <ul className="contact-location-list pickup-list">
                      {locations.map((location) => (
                        <li key={location.id}>
                          <strong>{location.loc_name || location.display_name}</strong>
                          <span>{location.display_name}{location.status === "closed" ? " · Currently closed" : ""}</span>
                        </li>
                      ))}
                    </ul>
                  ) : <p>Contact our team to confirm pickup arrangements.</p>}
                </article>
              </div>
              <div className="contact-map-panel">
                <div className="contact-map-heading"><span><i className="fa-solid fa-location-dot" aria-hidden="true" /> Pickup location map</span></div>
                {locations.length ? <DeferredPickupMap locations={locations} /> : <p className="contact-map-empty">No pickup locations are configured yet.</p>}
              </div>
            </div>
          </div>
        </section>
      </main>

      <div className="kerb-strip" aria-hidden="true" />
      <footer className="site-footer">
        <div className="wrap footer-grid">
          <div className="footer-brand">
            <a className="logo footer-logo" href="#top">{settings.companyName}</a>
            <h2>{about.title}</h2>
            <p>{about.body}</p>
            <div className="social-links">
              {content.socialLinks.filter((link) => link.url.trim()).map((link) => (
                <a href={link.url} key={link.platform} target="_blank" rel="noreferrer">{link.label}</a>
              ))}
            </div>
          </div>
          <div>
            <h3>Explore</h3>
            <a href="#fleet">Fleet</a><a href="#rates">Rates</a><a href="#how">How it works</a><a href="#faq">FAQ</a>
          </div>
          <div>
            <h3>Contact</h3>
            <a href="#contact">Talk to a live agent</a>
            {contact?.phone && <a href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`}>{contact.phone}</a>}
            {contact?.email && <a href={`mailto:${contact.email}`}>{contact.email}</a>}
            <a href="/admin">Admin sign-in</a>
          </div>
          <div className="footer-insurance">
            <h3>Vehicle insurance</h3>
            <p>Need insurance for your vehicle? Explore coverage with UniVanguard Insurance Agency Inc.</p>
            <a href="#contact">Ask our live agent</a>
          </div>
        </div>
        <div className="wrap footer-bottom">
          <span>© {new Date().getFullYear()} {settings.companyName}. All rights reserved.</span>
          <span>Rates and fleet information are subject to confirmation.</span>
        </div>
      </footer>
      <ChatWidget />
    </>
  );
}

function SectionHeading({
  eyebrow,
  title,
  children,
  centered = false,
}: {
  eyebrow: string;
  title: string;
  children?: React.ReactNode;
  centered?: boolean;
}) {
  return (
    <div className={`section-heading section-head${centered ? " is-centered center" : ""}`}>
      <p className="eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
    </div>
  );
}

function DeferredPickupMap({
  locations,
}: {
  locations: Extract<SiteAsset, { asset_type: "location" }>[];
}) {
  const [visible, setVisible] = useState(false);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!container) return;
    if (!("IntersectionObserver" in window)) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "200px" });
    observer.observe(container);
    return () => observer.disconnect();
  }, [container]);

  return (
    <div className="pickup-map-frame" ref={setContainer}>
      {visible ? (
        <Suspense fallback={<div className="pickup-map" role="status">Loading pickup map…</div>}>
          <PickupMap locations={locations} />
        </Suspense>
      ) : (
        <div className="pickup-map" role="img" aria-label="Pickup map will load when it is visible" />
      )}
    </div>
  );
}

function Fee({ label, value, currency, detail }: { label: string; value: number; currency: string; detail: string }) {
  const [expanded, setExpanded] = useState(false);
  const formattedValue = currency === "%" ? `${value}%` : formatCurrency(value, currency);
  return (
    <button
      className={`fee-chip${expanded ? " is-expanded" : ""}`}
      type="button"
      aria-expanded={expanded}
      onClick={() => setExpanded((current) => !current)}
    >
      <b>{formattedValue}</b>
      <span>{label}</span>
      <span className="fee-chip-detail" aria-hidden={!expanded} inert={!expanded}><span>{detail}</span></span>
    </button>
  );
}

function iconClass(name: string): string {
  const icons: Record<string, string> = {
    user: "fa-user",
    gear: "fa-gear",
    fuel: "fa-gas-pump",
    location: "fa-location-dot",
    car: "fa-car-side",
    calendar: "fa-calendar-days",
    clipboard: "fa-clipboard-list",
    card: "fa-credit-card",
    phone: "fa-phone",
    key: "fa-key",
    shield: "fa-shield-halved",
  };
  return icons[name] ?? "fa-circle-info";
}
