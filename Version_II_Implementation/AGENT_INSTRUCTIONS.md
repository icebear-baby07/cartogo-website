# carTOGO Version II

This is the isolated, incremental replacement workspace. Website and chatbot
are separate applications here; the official `Cartogo` directory is not
modified or replaced by this project.

## Handoff for a new agent session

Use this section as the starting brief when continuing work in a fresh chat.

### Goal

Build Version II as a behavior-preserving replacement for the existing
Cartogo website and its related services. Migrate one roadmap section at a
time, keep existing MongoDB schemas and data compatible, and verify each
section before moving on. The original `Cartogo` application is the reference
for current behavior, not a target for edits. Do not cut over, delete, or
replace it unless the user explicitly authorizes that.

### Working rules

- Work only in `Version_II_Implementation` unless the user explicitly expands
  the scope.
- Before editing, inspect `git status` and the relevant files. This worktree
  may contain unrelated edits, untracked files, or deletions; preserve them
  and never reset, clean, or revert changes you did not make.
- Follow the roadmap below in order. Section 8 — Admin UI is implemented;
  final non-production workflow verification remains.
  Confirm existing APIs and legacy workflows before wiring screens; do not
  claim a workflow is complete unless it works end to end.
- Preserve existing user-visible behavior and database document shapes.
  Prefer shared API contracts, validation, and established app patterns.
- Keep secrets server-side. Never print, copy into source control, or bundle
  MongoDB credentials, Supabase service-role keys, or SMTP credentials.
  `VITE_*` values are public browser configuration; only the Supabase URL and
  anon key belong in the website environment.
- Make focused changes, update this README when scope or status changes, and
  run the narrowest relevant tests plus build and `git diff --check`.
- Ask before making consequential product or data-migration decisions. Do not
  assume production access or use production data for development/testing.

### Current state

- Sections 1–7 are implemented to varying degrees as recorded in the roadmap.
  Section 7 provides protected admin APIs, inquiry actions, role management,
  and owner-approved resource/account changes. Owner approval uses a
  short-lived, attempt-limited PIN sent by API-side SMTP.
- Section 8's admin dashboard and core workflows are implemented; final legacy
  capability parity is still under review. Section 9 now includes the booking
  inquiry flow, guest email verification,
  optional verified Google sign-in, server-calculated pricing, and a persistent
  confirmation-email outbox. Renters choose the rate area and the API calculates
  prices from database rates. Section
  10's React chatbot widget and embedding are implemented. Section 11 remains
  non-production end-to-end verification; production cutover still requires
  an explicit go signal.
- The chatbot's Python/Bedrock service remains isolated in `apps/chatbot`;
  the public site now embeds a React/TypeScript chat widget through a
  same-origin API proxy. The old standalone HTML/JavaScript chatbot page is
  retained as a fallback and direct local test surface.
- A legacy-appearance pass is in progress: Version II reuses the Cartogo site
  and admin stylesheets, compatible React styles, and selected fleet photos.
  The public header, hero, fleet, rates, contact, and chat launcher have been
  aligned while keeping the new APIs and booking flow. This is not yet a claim
  of pixel-perfect parity; compare the remaining booking/chat states and all
  authenticated admin tabs before calling the visual migration complete.
- Automated validation: all 5 contract tests and 31 API tests pass; the
  contracts/API/website production build and `git diff --check` pass. The
  website build reports a large MapLibre chunk.
- Read-only local smoke checks: the running API reports healthy and MongoDB
  ready; public fleet/content/assets endpoints respond; the website renders,
  keeps inquiry submission disabled until required fields are ready, and
  calculates rates from the renter-selected area. The admin sign-in
  page renders, and its identity API rejects unauthenticated requests. These
  checks did not submit inquiries or change admin data. The API env file is
  present, but its MongoDB URI is reported to match the one used by the legacy
  application; treat this as potentially production and do not run write
  tests until a dedicated non-production URI is configured and confirmed. The
  website env file also contains server-only variable names and should be
  reduced to browser-safe `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
  settings; its values were not inspected or changed.

### Setup and checks

Run commands from this directory in PowerShell:

```powershell
npm.cmd install
npm.cmd run dev
```

This starts the website on all network interfaces at port `5173` and the API
at `http://127.0.0.1:3001`. Vite prints `Network` URLs for other devices on
the same network; use the current URL shown there because the host's LAN IP
may change. To limit the website to this computer, set
`$env:CARTOGO_SITE_HOST = "127.0.0.1"` before starting. The API stays bound to
loopback and remains reachable through the website's `/api` proxy. In another
terminal, `npm.cmd run dev:chatbot` starts the chatbot at
`http://127.0.0.1:8003`. If a port is already in use, inspect the existing
service rather than blindly starting or stopping it.

Useful checks:

```powershell
npm.cmd test
npm.cmd run build
git diff --check
```

The chatbot has its own setup and verification instructions in
[`apps/chatbot/OPERATIONAL_TUTORIAL.md`](apps/chatbot/OPERATIONAL_TUTORIAL.md).
Keep its environment and Python virtual environment separate from the
website/API.

### Environment-file boundaries

- `apps/api/.env` is for server-side MongoDB, Supabase server configuration,
  SMTP, and owner-approval settings. Use
  `apps/api/.env.example` as the server-side template. The chatbot proxy uses
  `CHATBOT_URL` or defaults to `http://127.0.0.1:8003`. Booking inquiries
  also use the configured guest-challenge and email-outbox collection names;
  guest verification requires SMTP credentials. Set the same
  `GUEST_EMAIL_VERIFICATION_SECRET` on every API instance; if omitted, the
  SMTP app password is used as the HMAC key for short-lived verification
  codes.
- `apps/website/.env` should contain only `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_ANON_KEY`. Keep its example equally limited. Do not put
  MongoDB, SMTP, or Supabase service-role credentials there.
- `apps/chatbot/.env` is separate and is loaded by the chatbot service. Use
  `apps/chatbot/.env.example` as its template.
- Local `.env` files are ignored by Git. Check only variable names when
  diagnosing configuration; do not echo or include their values in logs,
  chat responses, screenshots, or commits.
- Before testing admin changes, verify that the API environment has the
  required configuration without displaying its values. Owner PIN email
  requires SMTP settings; admin account changes require the server-side
  Supabase service-role key. Restart the API after changing its environment.

## Application layout

- `apps/website` — React + TypeScript public website UI, port `5173`.
  Website components are grouped under `apps/website/src/Admin` for admin
  workflows and `apps/website/src/Site` for public-site workflows. Shared
  bootstrap, authentication client, and global styles remain directly under
  `src`.
- `apps/api` — Express + TypeScript website API, port `3001`.
- `apps/chatbot` — isolated Python/Bedrock chatbot service, port `8003`, with
  its environment, dependencies, tests, and retained legacy standalone UI.
  The public site uses its React widget and the API's same-origin chat proxy;
  the original `Cartogo/chatbot` remains untouched.
- `packages/contracts` — shared website API types and server-side validation.

Run the API and website from this directory:

```powershell
.\start_site.cmd
```

The first launch installs JavaScript dependencies when needed and creates
missing environment files from their examples. Configure the new `.env` files
and run the launcher again. On Linux/macOS, use `bash ./start_site.sh`.

To launch the website/API and chatbot together, use `.\start_cartogo.cmd` on
Windows or `bash ./start_cartogo.sh` on Linux/macOS. The Windows launcher opens
separate terminals for AWS sign-in, the website/API, and the chatbot. The shell
launcher runs AWS sign-in first when the AWS CLI is installed, then runs the
chatbot alongside the website/API.

To run only the Version II chatbot:

```powershell
.\apps\chatbot\start_chat.cmd
```

On Linux/macOS, run `bash ./apps/chatbot/start_chat.sh`. The Windows chatbot
launcher prepares an isolated Python environment at `ctg-venv`; the shell
launcher uses `.venv-chatbot`. Configure the chatbot's own `apps/chatbot/.env`
for MongoDB and Bedrock/AWS access. Do not copy the official chatbot `.env` or
virtual environment.

Open the website at `http://127.0.0.1:5173/` on the host computer, or use a
Vite `Network` URL from another device on the same network. The separate
chatbot is at `http://127.0.0.1:8003/`.

The website's public data still requires a development MongoDB URI in
`apps/api/.env`. The chatbot service has a separate `.env` because it uses
MongoDB for bot identity, company knowledge, and chat logs.

## Section 1 — Foundation

- React + TypeScript website frontend: `http://127.0.0.1:5173`
- Express + TypeScript API: `http://127.0.0.1:3001`
- Separate chatbot UI/service: `http://127.0.0.1:8003`
- `/api/health` reports API liveness.
- Custom CSS is used; Tailwind is intentionally not included.
- Node 22 or newer is recommended.

## Section 2 — MongoDB connection

- The API loads `apps/api/.env` and requires the server-only `MONGODB_URI`.
- API application data, including booking verification challenges and the
  email outbox, uses `MONGODB_SITE_DATABASE`, which defaults to `Site`.
- `/api/health/ready` pings MongoDB and reports readiness without exposing
  connection details. The starter UI shows MongoDB connection status.
- The API remains available for liveness checks when MongoDB is not configured
  or temporarily unreachable; readiness returns HTTP 503 and logs the error.
- The MongoDB client is reused and closed during graceful shutdown.
- A live database handshake still needs verification with a non-production
  development URI in `apps/api/.env`.

## Section 3 — Shared API contracts

- `packages/contracts` publishes Zod schemas and inferred TypeScript types for
  health/readiness responses, API errors, vehicle records, site assets, and
  public site content.
- The API uses Zod for server-side runtime validation. The React app imports
  contract types only and uses small health/readiness guards, avoiding a Zod
  runtime dependency in the browser bundle.
- The database-facing DTO schemas preserve additional document fields so a
  public read API can migrate without dropping existing Mongo data.
- Contract tests cover valid and invalid payloads. Future endpoint migrations
  should validate requests and responses with these schemas as they are added.

## Section 4 — Public read APIs (current)

- `GET /api/public/units` reads the configured fleet collection, filters out
  `Inactive` vehicles, and sorts by numeric `id`.
- `GET /api/site-assets` reads configured public location/contact assets,
  sorted by numeric `id`.
- `GET /api/site-content` reads the public site-content document (`_id:
  "public"`).
- Its optional `labels.termsAndConditions` string is served publicly and
  displayed in the booking Terms & Conditions dialog. An authorized database
  operator can edit `Site.site_content` document `_id: "public"` directly;
  changes appear after the site reloads. Store only text intended for public
  visitors there.
- MongoDB collection defaults match the current website: `vehicles`,
  `site_assets`, and `site_content` in the `Site` database. Override them with
  `MONGODB_UNITS_COLLECTION`, `MONGODB_SITE_ASSETS_COLLECTION`, and
  `MONGODB_SITE_CONTENT_COLLECTION`.
- MongoDB `_id` fields are excluded from public responses. Every result is
  checked against its shared contract; missing content, invalid records, and
  database errors return HTTP 503 with a non-sensitive error.
- Read API tests use an in-memory repository. A live MongoDB integration check
  still requires a configured non-production database.

Copy `apps/api/.env.example` to `apps/api/.env`, then set `MONGODB_URI` to the
MongoDB URI used for a development/test database. Do not copy production
credentials into the repository. Never point Version II testing at production
until its data access and writes have been deliberately configured.

The website and API build with `npm.cmd run build`. The website build checks
TypeScript before bundling, and the API build runs `tsc`.

## Integration sections

Each section is to be implemented and verified independently in Version II.
Do not delete or replace the official application until explicitly authorized.

1. **Foundation** — workspace, TypeScript, React/Express starter, separate ports.
2. **MongoDB connection** — implemented: server-only configuration and
   connection lifecycle. Collection access is part of the later API sections.
3. **Shared API contracts** — implemented: typed schemas, inferred DTO types,
   runtime validation, and contract tests.
4. **Public read APIs** — implemented: validated, read-only site-content,
   public fleet, and site-asset endpoints.
5. **Public website UI** — implemented: responsive React public landing page,
   fleet filtering, rates, FAQs, pickup details, contact actions, and a booking
   inquiry form with legacy rental modes, estimate/discount recap, guest email
   verification, and verified Google account submission. The form searches
   Philippine destinations and validates road/residential access before
   selecting a rate area. The API independently repeats destination validation
   and calculates pricing from MongoDB fleet rates and site discount rules.
   A legacy-appearance pass has been started using the original public styles
   and selected photos; finish visual comparison across booking and responsive
   states before claiming full design parity.
6. **Supabase authentication** — implemented: PKCE Google sign-in, a protected
   `/api/auth/me` identity check, and server-side access-token verification
   against Supabase Auth and the admin allowlist RPC. Public booking accepts
   a Google session only when its verified Supabase profile identifies Google
   as a provider; otherwise the guest email verification path is required.
   Configure
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in
   `apps/website/.env`; configure the matching `SUPABASE_URL` and
   `SUPABASE_ANON_KEY` in `apps/api/.env`, then restart the API. Only the
   public anon key is used in
   the browser. The service-role key must remain server-side and is not part
   of this authentication flow. Configure the Supabase Google provider and
   allow `http://127.0.0.1:5173/admin` in its redirect URL settings (plus the
   deployed admin URL when applicable). The `/admin` route verifies access;
   the authenticated dashboard is described in Section 8.
7. **Admin APIs** — implemented: permission-checked admin reads, inquiry
   actions, chat-session listing, role management, and owner-approved fleet,
   asset, content, and account changes. Owner PINs are stored hashed in
   MongoDB with a five-minute expiry and five-attempt limit, and are delivered
   through API-side SMTP. Protected routes include `GET /api/admin/me`,
   `/roles`, `/units`, `/site-assets`, `/site-content`, `/inquiries`, and
   `/chat-sessions`; changes use the existing inquiry and
   `/owner-change/request` and `/owner-change/approve` flows. Configure
   `SMTP_*`, `SUPABASE_SERVICE_ROLE_KEY`, `CARTOGO_INITIAL_OWNER_EMAIL`, and
   the MongoDB collection names in `apps/api/.env`; never put server-only
   keys in the website environment.
8. **Admin UI** — implemented: authenticated admin dashboard with
   permission-aware sections for inquiries, fleet, site assets, site content,
   chat sessions, and owner-managed accounts. It supports inquiry CSV export
   and all public content fields, including discount rules and social links.
   Changes requiring approval use the existing owner PIN request and
   verification flow. CSV export includes the full legacy inquiry field set,
   and resetting public content to defaults is available behind confirmation
   and owner approval. Authenticated workflows still need non-production
   end-to-end verification.
9. **Email and booking integrations** — implemented. API-side SMTP sends
   branded HTML emails with plain-text alternatives for owner approvals, guest
   email verification, inquiry confirmations, and rejection notices. Public
   inquiries are saved in the legacy-compatible MongoDB shape, require a
   single-use guest verification token, and enqueue confirmation emails in the
   persistent outbox; a worker retries delivery up to five times. The booking
   rate area is selected by the renter and pricing is recalculated against
   database rates. The public site renders pickup locations on a
   MapLibre/OpenStreetMap map. The map uses OpenStreetMap raster tiles with
   attribution; select a suitable tile provider and follow its usage policy
   before high-volume production use. Guest booking/email, live MongoDB writes,
   Supabase callbacks, owner-approved admin changes, and production tile-provider
   selection still need verification.
10. **Chatbot separation** — implemented: isolated Python/Boto3 service,
    embedded React/TypeScript public chat widget, same-origin API proxy, safe
    session IDs, bounded history, suggestions, and clearly disclosed offline
    agent preview. The standalone legacy chatbot UI remains available for
    local fallback/testing.
11. **End-to-end verification and cutover** — partially complete: automated
    tests/build and safe local read-only smoke checks pass. Before cutover,
    configure and confirm a dedicated non-production database (the current
    API URI is reported to match the legacy application's), verify
    booking/email and authenticated admin workflows against staging, and
    select a production tile provider. Compare behavior and deployments; wait
    for an explicit go signal before changing the official application. Never
    test write workflows against an unconfirmed database.

MongoDB schemas and existing data should remain unchanged during the initial
application migration. Keep credentials in local environment files; never
bundle database or service-role credentials into the browser application.
