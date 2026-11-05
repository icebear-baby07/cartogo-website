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
- Follow the roadmap below in order. Section 8 — Admin UI is now in progress.
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
- Section 8, the admin dashboard and its UI workflows, is being implemented.
  Sections 9–11 still include remaining email/geocoding work, chatbot UI
  migration and embedding, and final verification/cutover.
- The chatbot is currently an isolated copy with its own Python service and
  existing standalone HTML/JavaScript UI; it is not yet a React app embedded
  in the website.
- Existing validation at the last implementation checkpoint: contract and
  API tests passed, the contracts/API/website production build passed, and
  `npm audit` reported no vulnerabilities. Re-run checks after making changes;
  these results do not validate live credentials, SMTP delivery, OAuth
  callbacks, or live database writes.

### Setup and checks

Run commands from this directory in PowerShell:

```powershell
npm.cmd install
npm.cmd run dev
```

This starts the website at `http://127.0.0.1:5173` and API at
`http://127.0.0.1:3001`. In another terminal, `npm.cmd run dev:chatbot`
starts the chatbot at `http://127.0.0.1:8003`. If a port is already in use,
inspect the existing service rather than blindly starting or stopping it.

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
  SMTP, owner-approval settings, and optional `GEOCODING_CONTACT_EMAIL`. Use
  `apps/api/.env.example` as the server-side template.
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
- `apps/api` — Express + TypeScript website API, port `3001`.
- `apps/chatbot` — isolated copy of the existing chatbot UI and Python/Bedrock
  service, port `8003`. It has its own environment file, dependencies, and
  tests; the original `Cartogo/chatbot` remains untouched. The copied UI is
  still the existing HTML/JavaScript version; its React/TypeScript rewrite is
  future work.
- `packages/contracts` — shared website API types and server-side validation.

Run the website and API from this directory:

```powershell
npm.cmd install
npm.cmd run dev
```

In another terminal, run the Version II chatbot:

```powershell
npm.cmd run dev:chatbot
```

Open the website at `http://127.0.0.1:5173/` and the separate chatbot at
`http://127.0.0.1:8003/`. The chatbot launcher prepares an isolated Python
environment at `ctg-venv` in this Version II root; configure its own
`apps/chatbot/.env` for
MongoDB and Bedrock/AWS access. Do not copy the official chatbot `.env` or
virtual environment.

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
- `MONGODB_DATABASE` defaults to `cartogo`; `MONGODB_SITE_DATABASE` defaults
  to `Site`, matching the existing application's database split.
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
   fleet filtering, rates, FAQs, pickup details, and contact actions. Booking
   submission and MapLibre location maps remain deferred until their API/auth
   and geocoding integrations are migrated; visitors are directed to the live
   agent rather than being shown a nonfunctional booking form.
6. **Supabase authentication** — implemented: PKCE Google sign-in, a protected
   `/api/auth/me` identity check, and server-side access-token verification
   against Supabase Auth and the admin allowlist RPC. Configure
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in
   `apps/website/.env`; configure the matching `SUPABASE_URL` and
   `SUPABASE_ANON_KEY` in `apps/api/.env`, then restart the API. Only the
   public anon key is used in
   the browser. The service-role key must remain server-side and is not part
   of this authentication flow. Configure the Supabase Google provider and
   allow `http://127.0.0.1:5173/admin` in its redirect URL settings (plus the
   deployed admin URL when applicable). The `/admin` route verifies access;
   dashboard features remain in Section 8.
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
8. **Admin UI** — in progress: authenticated admin dashboard with
   permission-aware sections for inquiries, fleet, site assets, site content,
   chat sessions, and owner-managed accounts. Changes requiring approval use
   the existing owner PIN request and verification flow. Verify end-to-end
   workflows and add any remaining legacy admin capabilities before marking
   complete.
9. **Email and geocoding integrations** — in progress: API-side SMTP is used
   for owner-approval PINs and inquiry rejection notices; the public site now
   renders pickup locations on a MapLibre/OpenStreetMap map. The API provides
   rate-limited, cached Philippine Nominatim location search, with optional
   `GEOCODING_CONTACT_EMAIL` for its identifying User-Agent. Durable inquiry
   confirmation/outbox delivery and remaining booking geocoding workflows are
   still deferred with booking submission. The map uses OpenStreetMap raster
   tiles with attribution and should comply with the tile service usage policy;
   select a suitable tile provider before high-volume production use.
10. **Chatbot separation** — copied to `apps/chatbot` with its existing
    standalone UI and Python/Boto3 service. React/TypeScript UI migration and
    website embedding remain future work.
11. **End-to-end verification and cutover** — compare behavior, test deployments,
    and wait for an explicit go signal before changing the official application.

MongoDB schemas and existing data should remain unchanged during the initial
application migration. Keep credentials in local environment files; never
bundle database or service-role credentials into the browser application.
