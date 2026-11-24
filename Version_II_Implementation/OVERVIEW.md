# carTOGO Version II — Project Overview

This document explains the purpose of the Version II application, how its
parts fit together, and how to run it on a prepared or new development device.
It describes the project in
`Version_II_Implementation`; it does not describe or replace the official
legacy application.

## 1. Non-technical overview

### What the site is about

carTOGO is a car-rental website for people looking to browse rental vehicles,
review rates and pickup information, and send a rental inquiry. The site also
provides an administrator area for authorized staff to manage inquiries and
selected website information.

Version II is a new implementation intended to progressively replace the
legacy site while preserving its existing data formats and expected
customer workflows. It is still under development. It must not be treated as
the production replacement until the remaining staging checks are completed
and a cutover is explicitly approved.

### What it does

For visitors, the website:

- Shows the rental fleet and lets visitors browse/filter available vehicles.
- Displays rental rates, pickup and contact information, and other public
  website content, with public-site photos served from Supabase Storage.
- Lets a visitor enter trip details, review a Reservation Recap, optionally
  request an extra driver or child seat, and then send a rental inquiry. The API
  independently validates the inquiry and calculates rental and add-on pricing
  from the configured database rates, discount rules, and site-content fees.
- Supports guest email verification and an optional verified Google sign-in
  for booking inquiries. An inquiry is a request, not a confirmed reservation;
  the team still needs to confirm availability.
- Displays pickup locations on a map and provides a customer chat interface.
- Displays Terms & Conditions from the configured public site-content store.

For authorized administrators, the protected admin area supports permission-
aware access to inquiries, fleet records, public site assets and content, chat
sessions, and account/role workflows. Some sensitive changes require owner
approval. The admin experience and its authenticated workflows still need
non-production end-to-end verification.

The public chat widget is part of the website. It sends requests through the
website API to the separate chatbot service when that service is running.
Without that service, assistant requests display an unavailable message. The
agent contact view is a local preview only; it is not connected to a staffed
support queue.

## 2. Technical overview

### How it works

The project is an npm workspace containing a browser application, a web API,
and shared TypeScript contracts. The chatbot is a separate Python application.
During local development, the browser app and API run together as separate
processes, and the optional chatbot runs in its own process. The Vite website
server listens on all network interfaces by default and prints the current
LAN URLs, so other devices on the same network can open it. Set
`CARTOGO_SITE_HOST=127.0.0.1` to restrict the website server to the local
computer.

```text
Browser
  |
  | React site, /api requests, optional Supabase Google sign-in
  v
Website (Vite, port 5173) ---- /api proxy ----> API (Express, port 3001)
                                                     |          |--> SMTP email
                                                     |          +--> Supabase
                                                     +--> Chat proxy
                                                            |
                                                            v
                                                   Chatbot (Python, port 8003)
                                                     |                        |
                                                     +--> Supabase +--> AWS Bedrock
```

The website's `/api` requests are proxied by Vite to the API in development.
The API validates incoming data against shared contracts and provides booking,
chat-proxy, and protected admin endpoints. Version II uses Supabase for its
application data, authentication, and storage. The API readiness endpoint
checks the configured Supabase project and required data resources.

The chatbot service is deliberately isolated from the website/API runtime. The
website API forwards chat requests to it at `http://127.0.0.1:8003` by default.
The bot uses Supabase for vehicle information, company knowledge, identity, and
chat logging, and AWS Bedrock for language-model responses. The standalone
chatbot page is retained for local access.

### Tools and their contributions

| Tool or service | Contribution |
| --- | --- |
| React | Builds the public website, booking interface, chat widget, and admin user interface. |
| TypeScript | Adds static types across the website, API, and shared contracts. |
| Vite | Runs the website development server, serves the production build, and proxies `/api` requests during development. |
| Node.js and npm workspaces | Run the TypeScript applications, manage shared JavaScript dependencies, and coordinate workspace scripts. Node.js 22 or newer is recommended and required by the Windows site launcher. |
| Express | Hosts the API, including public-data, booking, chat-proxy, health, authentication, and admin routes. |
| Supabase | Stores Version II fleet, site content/assets, inquiries, chatbot data, admin records, and email activity; provides Google sign-in, admin activity logging, and the public `cartogo-public-site-images` Storage bucket. API and chatbot server-side access uses server-only credentials. |
| Zod and `packages/contracts` | Define shared API schemas/types and validate API input and database-facing responses without changing the existing document formats. |
| Supabase Auth | Supports the configured Google sign-in flow and protected administrator identity/authorization checks. The browser uses only the public anon key; privileged keys stay on the API. |
| Nodemailer and SMTP | Send guest verification, inquiry, rejection, and owner-approval email. SMTP credentials belong only in the API environment. |
| Python 3.10+ | Runs the separate chatbot service and its isolated virtual environment. |
| Boto3 and AWS Bedrock | Let the chatbot call the configured Bedrock model. The server needs valid AWS credentials and permission to invoke that model; AWS CLI profiles or SSO are optional ways to provide credentials. |
| MapLibre GL and OpenStreetMap tiles | Render pickup locations. Production deployment must use a tile provider and usage policy appropriate to expected traffic. |

### Important data and security boundaries

- Version II API data is stored in the configured Supabase project. Site
  content is held in the `site_content_documents` table under the `public` ID.
  Public content must contain only material intended for website visitors.
- The API readiness endpoint checks Supabase availability and the fleet data
  resource used by the application.
- Public-site photos are served from the public Supabase Storage bucket
  `cartogo-public-site-images`. The website builds their URLs from
  `VITE_SUPABASE_URL`; local image fallback requires files in
  `apps/website/public/images` with the expected original filenames.
- The chatbot has its own environment file and uses the same Supabase project
  for fleet, knowledge, identity, and chat logs. Do not copy the legacy
  chatbot's environment file or virtual environment.
- Never put SMTP credentials or Supabase service-role keys in the browser
  environment. Never commit `.env` files.
- Keep each `.env` assignment on its own line.
- Use a dedicated, confirmed non-production database for development. Existing
  project notes flag the current API database URI as potentially matching the
  legacy application; do not write to it unless an authorized owner confirms
  it is safe.

## 3. Operating on an already set up device

These steps assume the project files, Node.js/npm, dependencies, and required
local configuration are already present.

### Start the website and API

1. Open PowerShell in the `Version_II_Implementation` directory.
2. Run:

   ```powershell
   npm.cmd run dev
   ```

3. Keep the terminal open. Use the `Network` URL printed by Vite to open the
   site from another device on the same network, or visit
   <http://127.0.0.1:5173/> on the host computer.

This command builds the shared contracts and starts the API and website
together. The API is available at <http://127.0.0.1:3001/>.

Alternatively, on Windows, run `.\start_site.cmd` from the project directory.
If a needed environment file does not exist, the launcher creates it from its
example and stops so you can configure it before starting again.

### Start the chatbot (optional)

In a second PowerShell terminal in the project directory, run:

```powershell
npm.cmd run dev:chatbot
```

The service is available at <http://127.0.0.1:8003/>. Its launcher reuses the
isolated `ctg-venv` Python environment on Windows and checks/installs its
requirements. The website can still show its offline chat preview if the
chatbot service is unavailable.

For full Bedrock-backed chatbot operation, AWS CLI v2 credentials/login,
permissions, and the chatbot's Supabase/AWS configuration must be valid.
On Windows, `.\start_cartogo.cmd` opens separate terminals for AWS login, the
website/API, and the chatbot. Use it only when those services and credentials
are configured.

### Stop and check

- Press **Ctrl+C** in the terminal running each service.
- Website: <http://127.0.0.1:5173/>
- API: <http://127.0.0.1:3001/>
- Optional chatbot: <http://127.0.0.1:8003/>
- Run checks from the Version II directory:

  ```powershell
  npm.cmd run build
  git diff --check
  ```

If a port is already in use, identify the existing process/service before
trying to stop or replace it.

## 4. Operating on an entirely new device

These are development setup instructions, not a production deployment guide.
They assume you have permission to access the project and any required
non-production databases and service accounts.

### Install prerequisites

For the website and API:

- Install Git if you need to clone the repository.
- Install Node.js 22 or newer (npm is included).
- Use PowerShell on Windows, or a terminal with Bash on Linux/macOS.

For the optional, full chatbot:

- Install Python 3.10 or newer.
- Install AWS CLI v2 and obtain authorized AWS credentials with access to the
  configured Bedrock model.
- Have authorized access to the Supabase project configured for the chatbot.

### Obtain and install the project

1. Clone the repository using the organization's approved access method, or
   copy the project securely. Do not transfer local `.env` files or credentials
   from another device.
2. Open a terminal in `Version_II_Implementation`.
3. Install JavaScript dependencies:

   ```powershell
   npm.cmd ci
   ```

   `npm.cmd ci` uses the committed lockfile to install the workspace
   dependencies. On Linux/macOS, use `npm ci`.

### Create and configure local environment files

Copy the example files and populate them with values issued for this device
and a confirmed non-production environment:

```powershell
Copy-Item apps\api\.env.example apps\api\.env
Copy-Item apps\website\.env.example apps\website\.env
Copy-Item apps\chatbot\.env.example apps\chatbot\.env
```

Only create/configure `apps\chatbot\.env` if you intend to run the chatbot.
On Linux/macOS, use `cp` with the equivalent paths. These files are local,
ignored by Git, and must not be committed.

Configure the API file (`apps/api/.env`) as needed:

- `SUPABASE_URL` and `SUPABASE_ANON_KEY` to match the browser's Supabase
  project when authentication is required.
- `SUPABASE_SERVICE_ROLE_KEY` and `CARTOGO_INITIAL_OWNER_EMAIL` only for
  server-side admin/account configuration that requires them.
- API data is stored in Supabase. Required tables and RPC functions must
  already exist; the one-off import utilities and cutover SQL files are not
  included in this repository.
- Email analytics activity events are stored in the Supabase
  `email_activity_logs` table. Events contain type, activity, and timestamp
  only; they do not contain recipient addresses or message content.
- Admin mutations write sanitized activity records to Supabase's
  `public.admin_activity_logs` table using the server-only Supabase secret
  key (or legacy service-role key). The table must be provisioned before
  enabling admin activity logging; no bootstrap SQL file is currently included.
  Ask the project owner for the approved schema if the table is not present.
  To inspect recent entries in the SQL Editor, run:

  ```sql
  SELECT occurred_at, actor_email, action, resource, resource_id, details
  FROM public.admin_activity_logs
  ORDER BY occurred_at DESC
  LIMIT 100;
  ```

  The log records inquiry status/restore/rejection actions and owner-change
  requests/approvals. It intentionally excludes customer records, rejection
  reasons, PINs, and email contents. If an action succeeds but its log write
  fails, the API reports that the change was applied and advises checking
  Supabase before retrying.
- `SMTP_*` settings when guest email verification or administrator email
  workflows need to send mail.
- `BOOKING_SMTP_FROM` optionally overrides `SMTP_FROM` for customer booking
  verification and confirmation emails only. Leave it unset to use `SMTP_FROM`;
  owner-approval PIN emails continue to use `SMTP_FROM`.
- Set a stable `GUEST_EMAIL_VERIFICATION_SECRET` on every API instance if
  using guest email verification; otherwise the configured SMTP app password
  is used as the HMAC key.
Configure the browser file (`apps/website/.env`) with only:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Use the URL and public anon key from the same Supabase project. Configure its
Google provider and the development redirect URL
`http://127.0.0.1:5173/admin` when Google/admin sign-in is required. Add the
deployed URL only when that deployment has been authorized and configured.
Never add service-role keys or SMTP credentials to this file.

Configure the chatbot file (`apps/chatbot/.env`) separately, using
`apps/chatbot/.env.example` as the template. The chatbot uses Supabase directly
and requires `SUPABASE_URL`, a server-only
`SUPABASE_SERVICE_ROLE_KEY`, and the chatbot's provisioned Supabase tables and
RPC functions. Configure AWS credentials with the approved AWS profile or SSO
flow and grant access to the selected Bedrock model. Do not reuse the official
legacy chatbot's environment file.

Do not paste credential values into source files, commits, tickets, or chat.
If you do not have the service credentials, ask the project owner for
development credentials rather than using production credentials.

### Start and verify

1. Start the website and API:

   ```powershell
   npm.cmd run dev
   ```

2. In a separate terminal, optionally start the chatbot:

   ```powershell
   npm.cmd run dev:chatbot
   ```

3. Visit the `Network` URL printed by Vite from other devices on the same
   network, or <http://127.0.0.1:5173/> on the host computer. The API's
   liveness endpoint is <http://127.0.0.1:3001/api/health>; its readiness
   endpoint is <http://127.0.0.1:3001/api/health/ready>.
4. Before exercising inquiry submission, email, or admin data changes, verify
   with the project owner that the API points to a dedicated non-production
   database and that all external integrations are approved.

For additional chatbot-specific information, see
[`apps/chatbot/OPERATIONAL_TUTORIAL.md`](apps/chatbot/OPERATIONAL_TUTORIAL.md).
For local service commands and troubleshooting, see [`RUNNING.md`](RUNNING.md).
