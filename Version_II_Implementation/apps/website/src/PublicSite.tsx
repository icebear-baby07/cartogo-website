import { lazy, Suspense, useEffect, useState } from "react";
import type {
  PublicUnit,
  SiteAsset,
  SiteContent,
} from "@cartogo/contracts";

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

  useEffect(() => {
    document.title = `${settings.companyName} — Car Rentals`;
  }, [settings.companyName]);

  const visibleUnits =
    activeCategory === "All"
      ? units
      : units.filter((unit) => unit.brand === activeCategory);
  const availableCount = units.filter((unit) => unit.status === "Available").length;
  const about = labels.about;

  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <div className="topbar">Reliable cars · Easy booking · Flexible pickup across Metro Manila</div>
      <div className="kerb-strip" aria-hidden="true" />
      <header className="site-header" id="top">
        <div className="wrap header-inner">
          <a className="logo" href="#top" aria-label={`${settings.companyName} home`}>
            {settings.companyName}
          </a>
          <button
            className="nav-toggle"
            type="button"
            aria-expanded={menuOpen}
            aria-controls="primary-nav"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className="visually-hidden">Toggle navigation</span>
            <span />
            <span />
            <span />
          </button>
          <nav
            className={`nav-links${menuOpen ? " is-open" : ""}`}
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
            <a className="button button-primary button-small" href="#contact" onClick={() => setMenuOpen(false)}>
              Contact to reserve
            </a>
          </nav>
        </div>
      </header>

      <main id="main">
        <section className="hero">
          <div className="wrap hero-grid">
            <div className="hero-copy">
              <p className="eyebrow">Book in minutes · Drive in hours</p>
              <h1>{inlineEmphasis(labels.hero.title)}</h1>
              <p className="hero-sub">{labels.hero.subtitle}</p>
              <div className="hero-actions">
                <a className="button button-primary" href="#fleet">Browse the fleet</a>
                <a className="button button-ghost on-dark" href="#how">How it works</a>
              </div>
            </div>
            <div className="hero-art">
              <img src="/images/main-picture.jpg" alt="carTOGO rental cars ready for your trip" />
              <span className="hero-art-caption">Your next trip starts here</span>
            </div>
          </div>
          <div className="road" aria-hidden="true" />
        </section>

        <div className="wrap trust-wrap">
          <div className="trust-strip" aria-label="Rental highlights">
            <div><strong>{units.length}</strong><span>Cars in our fleet</span></div>
            <div><strong>{categories.length - 1}</strong><span>Vehicle options</span></div>
            <div><strong>{locations.length || "Metro Manila"}</strong><span>Pickup areas</span></div>
            <div><strong>{availableCount}</strong><span>Currently available</span></div>
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
                  <article className="vehicle-card" key={unit.id}>
                    <div className="vehicle-image">
                      <img src={imageForUnit(unit)} alt={`${unit.display_name} rental vehicle`} loading="lazy" />
                      <span className="vehicle-category">{unit.brand}</span>
                      <span className={`availability${unit.status === "Available" ? "" : " is-unavailable"}`}>
                        {unit.status}
                      </span>
                    </div>
                    <div className="vehicle-body">
                      <h3>{unit.display_name}</h3>
                      <div className="vehicle-specs">
                        <span>{unit.capacity} seats</span>
                        <span>{unit.model}</span>
                        {unit.features.map((feature) => <span key={feature}>{feature}</span>)}
                      </div>
                      <p>{unit.features.length ? "Unit features listed above." : "Contact us for vehicle details."}</p>
                      <a className="button button-dark button-small" href="#contact">
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

        <section className="section section-paper" id="how">
          <div className="wrap">
            <SectionHeading eyebrow="Simple steps, no surprises" title="How renting with us works" centered />
            <div className="steps-grid">
              {labels.howItWorks.map((step, index) => (
                <article className="step-card" key={`${step.title}-${index}`}>
                  <span className="step-number">{String(index + 1).padStart(2, "0")}</span>
                  <h3>{step.title}</h3>
                  <p>{step.description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="section">
          <div className="wrap">
            <SectionHeading eyebrow="Why carTOGO" title="A smoother way to get moving" />
            <div className="benefit-grid">
              {labels.whyChooseUs.map((item, index) => (
                <article className="benefit-card" key={`${item.title}-${index}`}>
                  <span className="benefit-mark" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="section section-paper" id="rates">
          <div className="wrap">
            <SectionHeading eyebrow="Pricing" title="Rates & deposits">
              Rates vary by vehicle and destination. Long rentals may qualify for the listed discount.
            </SectionHeading>
            <div className="rates-scroll">
              <table className="rates-table">
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
            <div className="fee-grid">
              <Fee label="Extra driver / trip" value={settings.extraDriverFee} currency={settings.currency} />
              <Fee label="Child seat / trip" value={settings.childSeatFee} currency={settings.currency} />
              <Fee label="Late return / hour" value={settings.lateFeePerHour} currency={settings.currency} />
              <div className="fee-card"><strong>{settings.depositPercent}%</strong><span>Estimated refundable deposit</span></div>
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
            <div className="testimonial-grid">
              {labels.testimonials.map((item, index) => (
                <blockquote className="testimonial-card" key={`${item.name}-${index}`}>
                  <span className="quote-mark" aria-hidden="true">“</span>
                  <p>{item.quote}</p>
                  <footer><strong>{item.name}</strong><span>{item.detail}</span></footer>
                </blockquote>
              ))}
            </div>
          </div>
        </section>

        <section className="section section-paper" id="faq">
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

        <section className="section contact-section" id="contact">
          <div className="wrap contact-layout">
            <div>
              <p className="eyebrow">Ready when you are</p>
              <h2>Let’s plan your next drive.</h2>
              <p>Contact our live agent to ask about vehicle availability, pickup, and booking details. No payment is taken online.</p>
              <div className="contact-actions">
                {contact?.phone && <a className="button button-primary" href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`}>Call our team</a>}
                {contact?.email && <a className="button button-ghost on-dark" href={`mailto:${contact.email}`}>Email us</a>}
              </div>
            </div>
            <div className="contact-card">
              <h3>{contact?.display_name || "Live agent"}</h3>
              {contact?.description && <p>{contact.description}</p>}
              {contact?.phone && <p><span>Phone</span><a href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`}>{contact.phone}</a></p>}
              {contact?.email && <p><span>Email</span><a href={`mailto:${contact.email}`}>{contact.email}</a></p>}
              {contact?.operational_hours && <p><span>Hours</span>{contact.operational_hours}</p>}
              <h4>Pickup locations</h4>
              {locations.length ? (
                <>
                  <DeferredPickupMap locations={locations} />
                  <ul className="pickup-list">
                    {locations.map((location) => (
                      <li key={location.id}>
                        <strong>{location.loc_name || location.display_name}</strong>
                        <span>{location.display_name}{location.status === "closed" ? " · Currently closed" : ""}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : <p>Contact our team to confirm pickup arrangements.</p>}
            </div>
          </div>
        </section>
      </main>

      <div className="kerb-strip" aria-hidden="true" />
      <footer className="site-footer">
        <div className="wrap footer-grid">
          <div>
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
    <div className={`section-heading${centered ? " is-centered" : ""}`}>
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

function Fee({ label, value, currency }: { label: string; value: number; currency: string }) {
  return <div className="fee-card"><strong>{formatCurrency(value, currency)}</strong><span>{label}</span></div>;
}
