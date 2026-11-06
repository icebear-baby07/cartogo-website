import { useMemo, useRef, useState } from "react";
import { useEffect } from "react";
import type { FormEvent } from "react";
import type { PublicUnit, SiteContent } from "@cartogo/contracts";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../supabase";

type BookingFormProps = {
  units: PublicUnit[];
  content: SiteContent;
  selectedUnitId: string;
  onUnitChange: (id: string) => void;
};

type VerificationResponse = {
  challengeId?: string;
  verificationToken?: string;
};

type LocationSearchResult = {
  label: string;
  latitude: number;
  longitude: number;
};

type ValidatedDestination = {
  label: string;
  latitude: number;
  longitude: number;
  rateRegion: "in" | "out" | "luzon";
  snapDistanceMeters?: number;
};

function isLocationSearchResults(value: unknown): value is LocationSearchResult[] {
  return Array.isArray(value) && value.every((item) =>
    typeof item === "object" && item !== null &&
    "label" in item && typeof item.label === "string" &&
    "latitude" in item && typeof item.latitude === "number" &&
    "longitude" in item && typeof item.longitude === "number",
  );
}

function formatCurrency(value: number, currency: string): string {
  return `${currency}${new Intl.NumberFormat("en-PH", { maximumFractionDigits: 0 }).format(value)}`;
}

function dateAfter(date: string, days: number): string {
  if (!date) return "";
  const [year, month, day] = date.split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + days));
  return result.toISOString().slice(0, 10);
}

function isVerifiedGoogleUser(user: User | null): user is User {
  if (!user?.email) return false;
  const metadata = user.user_metadata;
  const providers = [
    user.app_metadata.provider,
    ...(Array.isArray(user.app_metadata.providers) ? user.app_metadata.providers : []),
    ...(user.identities ?? []).map((identity) => identity.provider),
  ];
  const verified = metadata.email_verified === true || metadata.email_verified === "true"
    || Boolean(user.email_confirmed_at || user.confirmed_at);
  return providers.includes("google") && verified;
}

async function postJson<T>(
  path: string,
  body: Record<string, unknown>,
  headers?: HeadersInit,
): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...Object.fromEntries(new Headers(headers).entries()) },
    body: JSON.stringify(body),
  });
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(result.error || "The request could not be completed.");
  return result;
}

export default function BookingForm({ units, content, selectedUnitId, onUnitChange }: BookingFormProps) {
  const [pickupDate, setPickupDate] = useState("");
  const [pickupTime, setPickupTime] = useState("09:00");
  const [rateRegion, setRateRegion] = useState("");
  const [destinationQuery, setDestinationQuery] = useState("");
  const [locationResults, setLocationResults] = useState<LocationSearchResult[]>([]);
  const [destination, setDestination] = useState<ValidatedDestination | null>(null);
  const [locationStatus, setLocationStatus] = useState("");
  const [searchingLocations, setSearchingLocations] = useState(false);
  const [rentalMode, setRentalMode] = useState<"hourly" | "custom_days">("hourly");
  const [rentalModePreview, setRentalModePreview] = useState<"hourly" | "custom_days" | null>(null);
  const [periodHours, setPeriodHours] = useState(24);
  const [rentalDays, setRentalDays] = useState(4);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [suffix, setSuffix] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [secondaryPhone, setSecondaryPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [code, setCode] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [verificationToken, setVerificationToken] = useState("");
  const [verificationMessage, setVerificationMessage] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(Boolean(supabase));
  const emailInput = useRef<HTMLInputElement>(null);
  const rentalModeField = useRef<HTMLFieldSetElement>(null);
  const requestId = useRef<string | null>(null);
  const locationRequestSequence = useRef(0);

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false);
      return;
    }
    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthUser(session?.user ?? null);
      setAuthLoading(false);
      if (!session) {
        setVerificationToken("");
        setChallengeId("");
      }
    });
    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return;
      if (sessionError) setError(`Could not read the Google sign-in session: ${sessionError.message}`);
      setAuthUser(data.session?.user ?? null);
      setAuthLoading(false);
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const googleUser = isVerifiedGoogleUser(authUser) ? authUser : null;
  const unit = units.find((item) => String(item.id) === selectedUnitId);
  const quote = useMemo(() => {
    if (!unit || !rateRegion || !pickupDate || !pickupTime) return null;
    const regionRate = rateRegion === "in"
      ? periodHours === 12 ? unit.in12_rate : unit.in24_rate
      : rateRegion === "out"
        ? periodHours === 12 ? unit.out12_rate : unit.out24_rate
        : unit.luzon_rate;
    const percent = rentalMode === "custom_days"
      ? content.discountRules.find((rule) =>
        rentalDays >= rule.minDays && rentalDays <= rule.maxDays,
      )?.percent ?? 0
      : 0;
    const undiscounted = regionRate * (rentalMode === "custom_days" ? rentalDays : 1);
    const discount = Math.round(undiscounted * percent) / 100;
    const elapsedDays = rentalMode === "custom_days"
      ? rentalDays
      : Math.floor((Number(pickupTime.slice(0, 2)) * 60 + Number(pickupTime.slice(3)) + periodHours * 60) / 1440);
    return {
      rate: regionRate,
      discountPercent: percent,
      discount,
      total: undiscounted - discount,
      rentalHours: rentalMode === "custom_days" ? rentalDays * 24 : periodHours,
      returnDate: dateAfter(pickupDate, elapsedDays),
      rentalDays: rentalMode === "custom_days" ? rentalDays : 1,
    };
  }, [unit, rateRegion, pickupDate, pickupTime, periodHours, rentalMode, rentalDays, content.discountRules]);
  const visibleRentalMode = rentalModePreview ?? rentalMode;
  const rentalDiscountPercent = content.discountRules.find((rule) =>
    rentalDays >= rule.minDays && rentalDays <= rule.maxDays,
  )?.percent ?? 0;

  const changeEmail = (value: string) => {
    setEmail(value);
    setChallengeId("");
    setVerificationToken("");
    setCode("");
    setVerificationMessage("");
  };

  const clearDestination = () => {
    locationRequestSequence.current += 1;
    setLocationResults([]);
    setDestination(null);
    setRateRegion("");
    setLocationStatus("");
  };

  const searchDestinations = async () => {
    const query = destinationQuery.trim();
    if (query.length < 3 || query.length > 200) {
      setLocationStatus("Enter a location search between 3 and 200 characters.");
      return;
    }
    const requestSequence = ++locationRequestSequence.current;
    setSearchingLocations(true);
    setError("");
    setLocationStatus("Searching Philippine locations…");
    try {
      const response = await fetch(`/api/target-location/search?q=${encodeURIComponent(query)}`, {
        cache: "no-store",
      });
      const result: unknown = await response.json();
      if (!response.ok) {
        const message = typeof result === "object" && result !== null && "error" in result
          ? String(result.error)
          : "Location search failed.";
        throw new Error(message);
      }
      if (!isLocationSearchResults(result)) {
        throw new Error("Location search returned invalid results.");
      }
      if (requestSequence !== locationRequestSequence.current) return;
      setLocationResults(result);
      setLocationStatus(result.length ? "Choose your destination to verify the road and rate area." : "No matching locations found. Try a more specific search.");
    } catch (requestError) {
      if (requestSequence === locationRequestSequence.current) {
        setLocationResults([]);
        setLocationStatus(requestError instanceof Error ? requestError.message : "Location search failed.");
      }
    } finally {
      if (requestSequence === locationRequestSequence.current) setSearchingLocations(false);
    }
  };

  const chooseDestination = async (result: LocationSearchResult) => {
    const requestSequence = ++locationRequestSequence.current;
    setLocationResults([]);
    setDestination(null);
    setRateRegion("");
    setLocationStatus("Verifying this destination and checking nearby roads…");
    setError("");
    try {
      const validated = await postJson<{
        valid: boolean;
        label: string;
        reason?: string;
        latitude?: number;
        longitude?: number;
        rateRegion?: string | null;
        snapped?: boolean;
        snapDistanceMeters?: number;
      }>("/api/target-location/validate", {
        latitude: result.latitude,
        longitude: result.longitude,
        snapInvalid: true,
      });
      if (requestSequence !== locationRequestSequence.current) return;
      if (!validated.valid) {
        setLocationStatus(validated.reason || "Choose a road-accessible residential destination.");
        return;
      }
      if (validated.rateRegion !== "in" && validated.rateRegion !== "out" && validated.rateRegion !== "luzon") {
        setLocationStatus(validated.rateRegion === "out_of_bounds"
          ? "We currently accept destinations in Luzon only."
          : "This destination is outside our supported service area.");
        return;
      }
      if (
        typeof validated.latitude !== "number" ||
        typeof validated.longitude !== "number"
      ) {
        setLocationStatus("The verified destination did not include valid road coordinates. Please choose another.");
        return;
      }
      const selected: ValidatedDestination = {
        label: validated.label || result.label,
        latitude: validated.latitude,
        longitude: validated.longitude,
        rateRegion: validated.rateRegion,
        ...(validated.snapped && typeof validated.snapDistanceMeters === "number"
          ? { snapDistanceMeters: validated.snapDistanceMeters }
          : {}),
      };
      setDestination(selected);
      setRateRegion(selected.rateRegion);
      if (selected.rateRegion === "luzon") setRentalMode("custom_days");
      setDestinationQuery(selected.label);
      setLocationStatus(
        `Verified destination · ${
          selected.rateRegion === "in" ? "Metro Manila" :
            selected.rateRegion === "out" ? "Nearby areas" : "Other Luzon"
        } rates${selected.snapDistanceMeters ? ` · snapped to a road ${selected.snapDistanceMeters} m away` : ""}.`,
      );
    } catch (requestError) {
      if (requestSequence === locationRequestSequence.current) {
        setLocationStatus(requestError instanceof Error ? requestError.message : "Could not verify this destination.");
      }
    }
  };

  const requestCode = async () => {
    if (!emailInput.current?.reportValidity()) return;
    setBusy(true);
    setError("");
    setVerificationMessage("Sending verification code…");
    try {
      const result = await postJson<VerificationResponse>(
        "/api/public/email-verification/request",
        { email },
      );
      setChallengeId(result.challengeId || "");
      setVerificationToken("");
      setVerificationMessage("Code sent. Check your inbox and spam folder. It expires in 10 minutes.");
    } catch (requestError) {
      setVerificationMessage("");
      setError(requestError instanceof Error ? requestError.message : "Could not send a verification code.");
    } finally {
      setBusy(false);
    }
  };

  const startGoogleSignIn = async () => {
    if (!supabase) {
      setError("Google sign-in is not configured. You can continue as a guest after verifying your email.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { error: signInError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/` },
      });
      if (signInError) throw signInError;
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : "Could not start Google sign-in.");
      setBusy(false);
    }
  };

  const signOutGoogle = async () => {
    if (!supabase) return;
    setBusy(true);
    setError("");
    try {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;
      setAuthUser(null);
      setEmail("");
    } catch (signOutError) {
      setError(signOutError instanceof Error ? signOutError.message : "Could not sign out.");
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await postJson<VerificationResponse>(
        "/api/public/email-verification/verify",
        { challengeId, code },
      );
      setVerificationToken(result.verificationToken || "");
      setVerificationMessage("Email verified. You can now submit your inquiry.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not verify that code.");
    } finally {
      setBusy(false);
    }
  };

  const submitInquiry = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setStatus("");
    if (!event.currentTarget.reportValidity()) return;
    if (!unit || !quote || !destination) {
      setError("Choose a vehicle, pickup date, and verified destination to see a valid estimate.");
      return;
    }
    if (!googleUser && (!challengeId || !verificationToken)) {
      setError("Verify your email address before sending this inquiry.");
      return;
    }
    requestId.current ??= crypto.randomUUID();
    setBusy(true);
    try {
      const authHeaders: Record<string, string> = {};
      if (googleUser && supabase) {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw new Error(`Could not read the Google sign-in session: ${sessionError.message}`);
        if (!session?.access_token) throw new Error("Your Google sign-in has expired. Sign in again.");
        authHeaders.Authorization = `Bearer ${session.access_token}`;
      }
      const result = await postJson<{
        inquiry: { id: number };
        emailNotificationQueued: boolean;
      }>("/api/public/inquiries", {
        clientRequestId: requestId.current,
        ...(googleUser ? {} : { challengeId, verificationToken }),
        email: googleUser?.email || email,
        firstName,
        lastName,
        middleName,
        suffix,
        phone,
        secondaryPhone,
        carId: String(unit.id),
        capacity: unit.capacity,
        pickupDate,
        pickupTime,
        returnDate: quote.returnDate,
        rateRegion,
        targetLatitude: destination.latitude,
        targetLongitude: destination.longitude,
        rentalMode,
        rentalPeriodHours: periodHours,
        estimatedRentalHours: quote.rentalHours,
        ratePerPeriod: quote.rate,
        rentalDays: quote.rentalDays,
        discountPercent: quote.discountPercent,
        discountAmount: quote.discount,
        quotedRate: quote.total,
        notes,
      }, authHeaders);
      setStatus(result.emailNotificationQueued
        ? `Inquiry #${result.inquiry.id} received. A confirmation email has been queued.`
        : `Inquiry #${result.inquiry.id} received. Our team will follow up by phone.`);
      requestId.current = null;
      setChallengeId("");
      setVerificationToken("");
      setEmail("");
      setCode("");
      setVerificationMessage("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not submit your inquiry.");
    } finally {
      setBusy(false);
    }
  };

  const today = new Date();
  const minDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  return (
    <section className="section bg-paper" id="booking">
      <div className="wrap">
        <div className="booking-panel">
          <div className="booking-overview">
            <div className="booking-header">
              <p className="eyebrow">Reserve</p>
              <h2>Tell us about your trip</h2>
            </div>
            <div className="booking-intro">
              <p>Submit your details and our team will confirm availability and the final rental details. No payment is taken online.</p>
              <ul className="booking-list">
                <li><b>01</b> We confirm your car and dates by phone or email.</li>
                <li><b>02</b> You pay the refundable deposit at pickup, not before.</li>
                <li><b>03</b> Bring your license, ID, and the confirmation reference.</li>
              </ul>
            </div>
          </div>
          <div className="booking-workspace">
            <form id="bookingForm" className="booking-form" onSubmit={(event) => void submitInquiry(event)}>
              <fieldset className="booking-fieldset">
                <legend>Rental details</legend>
            <div className="booking-fields">
              <label className="booking-field">
                Vehicle
                <select required value={selectedUnitId} onChange={(event) => onUnitChange(event.target.value)}>
                  <option value="">Choose a vehicle</option>
                  {units.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.display_name} · {item.capacity} seats{item.status === "Available" ? "" : ` · ${item.status}`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="booking-field">
                Pickup date
                <input required type="date" min={minDate} value={pickupDate} onChange={(event) => setPickupDate(event.target.value)} />
              </label>
              <label className="booking-field">
                Pickup time
                <input required type="time" value={pickupTime} onChange={(event) => setPickupTime(event.target.value)} />
              </label>
              <div className="booking-field booking-field-wide">
                <label htmlFor="booking-destination-search">Destination</label>
                <div className="booking-location-search">
                  <input
                    id="booking-destination-search"
                    type="search"
                    minLength={3}
                    maxLength={200}
                    autoComplete="off"
                    placeholder="Search a city, barangay, or address in the Philippines"
                    value={destinationQuery}
                    onChange={(event) => {
                      setDestinationQuery(event.target.value);
                      clearDestination();
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void searchDestinations();
                      }
                    }}
                  />
                  <button
                    className="button button-ghost"
                    type="button"
                    disabled={searchingLocations}
                    onClick={() => void searchDestinations()}
                  >
                    {searchingLocations ? "Searching…" : "Search"}
                  </button>
                </div>
                {locationResults.length > 0 && (
                  <ul className="booking-location-results" aria-label="Destination search results">
                    {locationResults.map((result, index) => (
                      <li key={`${result.latitude},${result.longitude},${index}`}>
                        <button type="button" onClick={() => void chooseDestination(result)}>
                          {result.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {locationStatus && <p className="booking-location-status" role="status">{locationStatus}</p>}
              </div>
              <fieldset
                ref={rentalModeField}
                className={`booking-rental-panel booking-field-wide ${rateRegion === "luzon" ? "is-luzon" : ""} ${rentalMode === "hourly" ? "hourly-selected" : "custom-selected"} ${rentalModePreview === "hourly" ? "hourly-hover-preview" : ""} ${rentalModePreview === "custom_days" ? "custom-hover-preview" : ""}`}
                onPointerLeave={() => setRentalModePreview(null)}
                onFocusCapture={(event) => {
                  const mode = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-rental-mode]")?.dataset.rentalMode;
                  if (mode === "hourly" || mode === "custom_days") setRentalModePreview(mode);
                }}
                onBlurCapture={(event) => {
                  const nextTarget = event.relatedTarget;
                  if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
                    setRentalModePreview(null);
                  }
                }}
              >
                <legend>Choose your rental arrangement</legend>
                <div className="booking-rental-mode-toggle" role="group" aria-label="Rental arrangement">
                  <button
                    className={`booking-rental-mode-card ${rentalMode === "hourly" ? "is-selected" : ""} ${rentalModePreview === "hourly" ? "is-previewed" : ""}`}
                    type="button"
                    data-rental-mode="hourly"
                    aria-pressed={rentalMode === "hourly"}
                    disabled={rateRegion === "luzon"}
                    onPointerEnter={(event) => {
                      if (event.pointerType !== "touch" && rateRegion !== "luzon") setRentalModePreview("hourly");
                    }}
                    onFocus={() => {
                      if (rateRegion !== "luzon") setRentalModePreview("hourly");
                    }}
                    onClick={() => {
                      setRentalMode("hourly");
                      setRentalModePreview(null);
                    }}
                  >
                    <span className="booking-rental-mode-title">12 / 24-hour rental</span>
                    <span className="booking-rental-mode-description">Flexible city rentals</span>
                  </button>
                  <button
                    className={`booking-rental-mode-card ${rentalMode === "custom_days" ? "is-selected" : ""} ${rentalModePreview === "custom_days" ? "is-previewed" : ""}`}
                    type="button"
                    data-rental-mode="custom_days"
                    aria-pressed={rentalMode === "custom_days"}
                    onPointerEnter={(event) => {
                      if (event.pointerType !== "touch") setRentalModePreview("custom_days");
                    }}
                    onFocus={() => setRentalModePreview("custom_days")}
                    onClick={() => {
                      setRentalMode("custom_days");
                      setRentalModePreview(null);
                    }}
                  >
                    <span className="booking-rental-mode-title">Custom day arrangement</span>
                    <span className="booking-rental-mode-description">Plan a 4–15 day trip</span>
                  </button>
                </div>
                <div className="booking-rental-controls booking-hourly-controls" hidden={visibleRentalMode !== "hourly"}>
                  <span className="booking-rental-control-label">Choose your rental period</span>
                  <div className="booking-period-toggle" role="group" aria-label="Rental period">
                    {[12, 24].map((hours) => (
                      <button
                        key={hours}
                        className={`booking-period-option ${rentalMode === "hourly" && periodHours === hours ? "is-selected" : ""}`}
                        type="button"
                        aria-pressed={rentalMode === "hourly" && periodHours === hours}
                        onPointerEnter={(event) => {
                          if (event.pointerType !== "touch") setRentalModePreview("hourly");
                        }}
                        onFocus={() => setRentalModePreview("hourly")}
                        onClick={() => {
                          setRentalMode("hourly");
                          setPeriodHours(hours);
                          setRentalModePreview(null);
                        }}
                      >
                        {hours} hours
                      </button>
                    ))}
                  </div>
                  <p className="booking-rental-hint">Choose 12 or 24 hours for hourly rentals.</p>
                </div>
                <div className="booking-rental-controls booking-custom-controls" hidden={visibleRentalMode !== "custom_days"}>
                  <label className="booking-rental-control-label" htmlFor="booking-rental-days">
                    Custom rental duration <output htmlFor="booking-rental-days">{rentalDays} days</output>
                  </label>
                  <input
                    id="booking-rental-days"
                    className="booking-rental-range"
                    type="range"
                    min={4}
                    max={15}
                    step={1}
                    value={rentalDays}
                    aria-valuetext={`${rentalDays} days`}
                    onChange={(event) => setRentalDays(Number(event.target.value))}
                  />
                  <div className="booking-rental-range-scale" aria-hidden="true"><span>4 days</span><span>15 days</span></div>
                  <p className="booking-rental-promo" aria-live="polite">
                    {rentalDiscountPercent > 0
                      ? `Enjoy ${rentalDiscountPercent}% off your ${rentalDays}-day custom arrangement.`
                      : `No long-rental discount applies at ${rentalDays} days.`}
                  </p>
                </div>
              </fieldset>
            </div>
            {quote && (
              <div className="booking-quote" aria-live="polite">
                <p>
                  Estimated rental subtotal: <strong>{formatCurrency(quote.total, content.settings.currency)}</strong>
                  {quote.discountPercent > 0 && ` · ${quote.discountPercent}% long-rental discount`}
                </p>
                <p>Destination: {destination?.label || "Verify a destination to calculate rates"} · Pickup {pickupDate} at {pickupTime} · Return {quote.returnDate} · Refundable deposit estimate ({content.settings.depositPercent}%): {formatCurrency(Math.round(quote.total * content.settings.depositPercent / 100), content.settings.currency)}</p>
                <small>Estimate only; the team will confirm availability and final pricing.</small>
              </div>
            )}
              </fieldset>
            </form>

          <aside className="booking-info" aria-label="Contact and submission details">
            <div className="booking-auth-cta">
              <p className="booking-auth-kicker">READY TO RESERVE?</p>
              <div className="booking-account-status">
                {authLoading ? (
                  <p className="booking-auth-copy" role="status">Checking your sign-in…</p>
                ) : googleUser ? (
                  <>
                    <p className="booking-auth-copy" role="status">Signed in with verified Google email: <strong>{googleUser.email}</strong></p>
                    <button className="button button-ghost" type="button" disabled={busy} onClick={() => void signOutGoogle()}>Sign out</button>
                  </>
                ) : (
                  <>
                    <p className="booking-auth-copy">Sign in with Google or provide your details below to send an inquiry.</p>
                    <button className="button button-ghost" type="button" disabled={busy} onClick={() => void startGoogleSignIn()}>
                      Continue with Google
                    </button>
                  </>
                )}
              </div>
            </div>
            {!googleUser && (
              <p className="booking-guest-note">Don't have a Google account? You can still book a vehicle by providing your information below.</p>
            )}
            <div className="booking-fields booking-contact-fields">
              {!googleUser && (
                <>
                  <label className="booking-field">First name<input form="bookingForm" required maxLength={80} autoComplete="given-name" value={firstName} onChange={(event) => setFirstName(event.target.value)} /></label>
                  <label className="booking-field">Last name<input form="bookingForm" required maxLength={80} autoComplete="family-name" value={lastName} onChange={(event) => setLastName(event.target.value)} /></label>
                  <label className="booking-field">Middle name<input form="bookingForm" maxLength={80} autoComplete="additional-name" value={middleName} onChange={(event) => setMiddleName(event.target.value)} /></label>
                  <label className="booking-field">Suffix<input form="bookingForm" maxLength={24} value={suffix} onChange={(event) => setSuffix(event.target.value)} /></label>
                </>
              )}
              <label className="booking-field">Email<input form="bookingForm" ref={emailInput} required maxLength={254} type="email" autoComplete="email" disabled={Boolean(googleUser)} value={googleUser?.email || email} onChange={(event) => changeEmail(event.target.value)} /></label>
              <label className="booking-field">Phone number<input form="bookingForm" required maxLength={24} type="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
              <label className="booking-field">Secondary phone (optional)<input form="bookingForm" maxLength={24} type="tel" value={secondaryPhone} onChange={(event) => setSecondaryPhone(event.target.value)} /></label>
              <label className="booking-field booking-field-wide">Notes (optional)<textarea form="bookingForm" maxLength={2000} rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
            </div>
            {!googleUser && (
              <div className="booking-verification">
                <button className="button button-ghost" type="button" disabled={busy} onClick={() => void requestCode()}>
                  {challengeId ? "Resend verification code" : "Send verification code"}
                </button>
                {challengeId && !verificationToken && (
                  <div className="booking-verify-row">
                    <label className="booking-field">6-digit code<input form="bookingForm" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} /></label>
                    <button className="button button-ghost" type="button" disabled={busy || code.length !== 6} onClick={() => void verifyCode()}>Verify email</button>
                  </div>
                )}
                {verificationMessage && <p className="booking-form-status" role="status">{verificationMessage}</p>}
              </div>
            )}

          {error && <p className="booking-form-error" role="alert">{error}</p>}
          {status && <p className="booking-form-success" role="status">{status}</p>}
          <div className="booking-submit">
            <button
              className="button button-primary"
              type="submit"
              form="bookingForm"
              disabled={busy || (!googleUser && !verificationToken) || !destination || !quote}
            >
              {busy ? "Please wait…" : "Send inquiry"}
            </button>
            <p>Submitting an inquiry does not reserve a vehicle or take payment.</p>
          </div>
            </aside>
          </div>
        </div>
      </div>
    </section>
  );
}
