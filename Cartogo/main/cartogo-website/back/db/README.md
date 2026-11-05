# New-device and database setup

This guide prepares a new device to run the current carTOGO website and optional chatbot with Supabase Auth and MongoDB.

The database scripts in this folder are for a **fresh installation**:

- `01_supabase_admin_accounts.sql` installs the Supabase administrator allowlist and its RPC functions.
- `02_supabase_bootstrap_first_admin.sql` adds the first verified Google account to that allowlist.
- `initialize_mongodb.py` initializes the MongoDB collections used by the website, creates indexes, seeds public site content and administrator title definitions, and can optionally insert starter pickup/contact records.

The current site stores fleet, site assets, public site content, customer inquiries, administrator titles/permissions, and website chat sessions in MongoDB. Supabase stores the `cartogo_admin_accounts` allowlist; Supabase Auth manages Google sign-in. Supabase's internal Auth tables are managed by Supabase and are not part of these scripts.

> The historical Supabase table-creation, migration, and cutover SQL files have been removed from this repository. This does **not** delete tables or data from any live Supabase project. Existing deployments may still have legacy tables.

## 1. Prerequisites

On the new Windows device, install:

- Python 3.10 or later.
- Git, if you are cloning the repository.
- A Supabase project.
- A MongoDB deployment reachable from this device (for example, MongoDB Atlas).
- Google OAuth configured for the Supabase project.
- Gmail SMTP credentials if guest email verification and Owner approval PINs are needed.
- AWS credentials with access to the configured Amazon Bedrock model if running the chatbot.

Clone/copy the repository to the device and open PowerShell. These instructions assume the project is at:

```powershell
D:\cartogo-jr\cartogo-website\Cartogo
```

If yours is elsewhere, substitute your actual project directory in every command.

## 2. Configure Supabase Auth

Use the **same Supabase project** for the project URL, public key, Google provider, and SQL scripts.

1. In Supabase Authentication, enable Google sign-in.
2. Create/configure the Google OAuth web client as required by Supabase. Add the callback URL shown in the Supabase Google provider settings to the Google OAuth client's authorized redirect URIs. Keep the Google client secret in Supabase; do not put it in this repository.
3. Configure the Supabase Site URL and Redirect URLs. At minimum, allow the local pages:

   ```text
   http://localhost:8002/front/index.html
   http://localhost:8002/front/admin.html
   http://127.0.0.1:8002/front/index.html
   http://127.0.0.1:8002/front/admin.html
   ```

   Add the deployed HTTPS pages and any LAN address patterns you actually use. The Google callback is the Supabase callback URL, not one of these site pages.
4. Open Supabase **SQL Editor**, paste/run [`01_supabase_admin_accounts.sql`](./01_supabase_admin_accounts.sql), and confirm it succeeds.

This creates `public.cartogo_admin_accounts`, enables RLS, revokes direct client table access, and creates the functions used by the website. Do not manually add other application tables for fleet, inquiries, site assets, roles, or website chat.

## 3. Configure website environment

Open PowerShell in the `Cartogo` directory and launch the website once:

```powershell
cd D:\cartogo-jr\cartogo-website\Cartogo
.\start_site.cmd
```

On first launch, the launcher creates `main\cartogo-website\.env` from `.env.example` and stops so you can configure it. Edit that `.env` and set:

| Variable | Required value |
|---|---|
| `SUPABASE_URL` | Project URL from the same Supabase project used for Google sign-in. |
| `SUPABASE_ANON_KEY` | That project's publishable/anon key. This is not the service-role key. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only service-role key. Needed for Owner-approved allowlist changes and migrations; never put it in browser code or share it. |
| `MONGODB_URI` | MongoDB connection URI. Use a database user with read/write privileges for the databases below. |
| `MONGODB_DATABASE` | Usually `cartogo`; stores customer inquiries and the email outbox. |
| `MONGODB_SITE_DATABASE` | Usually `Site`; stores fleet, site assets, site content, sequences, roles, and website chat sessions. |
| `CARTOGO_INITIAL_OWNER_EMAIL` | The exact email address of the first administrator you will bootstrap in Supabase. |
| `SMTP_USER`, `SMTP_APP_PASSWORD` | Gmail address and Google-generated app password for email delivery. |
| `SMTP_HOST`, `SMTP_PORT` | Usually `smtp.gmail.com` and `587`. |
| `SMTP_FROM` | Optional sender address; usually the same address as `SMTP_USER`. |

The checked-in `.env.example` has the remaining collection names and defaults. Keep the actual `.env` private and local; it is ignored by Git. Never expose the MongoDB URI or Supabase service-role key through `config.js`, browser JavaScript, or a public repository.

`MONGODB_EMAIL_OUTBOX_COLLECTION` defaults to `email_outbox`. The website saves confirmation-email jobs there and sends them in the background, so a slow SMTP server does not keep a successful booking inquiry waiting. Failed sends retry with backoff up to five times; inspect the outbox collection for jobs marked `failed`.

For MongoDB Atlas, also allow the device/server's network address in the Atlas network access list. Avoid broad public access unless you understand and accept the exposure.

## 4. Install website dependencies

Run these commands from `main\cartogo-website`:

```powershell
cd D:\cartogo-jr\cartogo-website\Cartogo\main\cartogo-website
py -3 -m pip install -r requirements.txt
```

The database initializer imports the website's MongoDB code and uses the configured URI from this directory's `.env`.

## 5. Initialize MongoDB

For an empty database with the sample pickup/contact locations:

```powershell
cd D:\cartogo-jr\cartogo-website\Cartogo\main\cartogo-website
py -3 back\db\initialize_mongodb.py --seed-starter-assets
```

The initializer:

- Creates the website's unique vehicle ID index, unique site-asset indexes, inquiry ID/date/idempotency indexes, email-outbox processing index, and chat-session date index.
- Inserts the default public site-content document only if it does not already exist.
- Creates/updates the Owner and Moderator permission definitions in MongoDB.
- Synchronizes vehicle, site-asset, and inquiry ID sequences to existing records.
- Adds the sample pickup locations and Live agent contact only when `site_assets` is empty and `--seed-starter-assets` is supplied.
- If `chatbot\.env` has a MongoDB URI, creates the chatbot request-log indexes too.

Review the sample contact and pickup details after initialization and change them in Admin Settings before public launch. The initializer **does not** insert fleet vehicles, customer inquiries, or chatbot knowledge documents. Add/import those separately.

For a database that already contains site assets, omit the seed option:

```powershell
py -3 back\db\initialize_mongodb.py
```

The initializer may be run again: existing site content is preserved, indexes are created idempotently, sequences only advance, and sample assets are never inserted into a non-empty site-assets collection.

## 6. Bootstrap the first administrator

The first Google account must exist in Supabase Auth before the bootstrap SQL can add it:

1. If the website server is not already running, start it using `start_site.cmd` from the `Cartogo` directory (see the next section). Keep it running through the bootstrap step.
2. Open `http://localhost:8002/front/admin.html` and sign in with the intended first Owner Google account. It is expected that access is denied before allowlisting.
3. Open [`02_supabase_bootstrap_first_admin.sql`](./02_supabase_bootstrap_first_admin.sql). Replace `REPLACE_WITH_GOOGLE_ACCOUNT_EMAIL` with the exact Google account email, keeping the surrounding SQL single quotes.
4. Run the edited script in the **same Supabase project's SQL Editor**. It checks that the account completed Google sign-in, has a confirmed email, and used Google as its provider before adding it.
5. Return to the admin page and sign in again.

Make sure `CARTOGO_INITIAL_OWNER_EMAIL` in the website `.env` exactly matches this email. When that allowlisted account first accesses the server, its MongoDB role is initialized as Owner. Other new allowlisted accounts default to Moderator. Existing role records are preserved.

Do not run the bootstrap script with a placeholder or for an account that has not completed Google sign-in. If the bootstrap email and `CARTOGO_INITIAL_OWNER_EMAIL` do not match, correct the configuration before relying on Owner-only administration.

## 7. Start the website

From the `Cartogo` directory, if the website is not already running:

```powershell
cd D:\cartogo-jr\cartogo-website\Cartogo
.\start_site.cmd
```

Keep the website terminal open. If it is already running from the administrator bootstrap step, do not launch a second copy. The launcher prints the local and LAN URLs; open the printed URL and verify:

- The public site loads.
- Public fleet/site data endpoints return successfully (fleet may be empty until vehicles are added).
- Admin sign-in works for the allowlisted Google account.
- Site assets appear in Admin Settings.
- Owner PIN email arrives when a protected change is requested.

For LAN testing, use a device on the same trusted network and the printed LAN URL. Allow Python through Windows Firewall on the Private network if prompted. Do not expose this development server directly to the public internet. If the LAN IP changes, update Supabase redirect allowlists as needed.

## 8. Optional chatbot setup

The website can run without the chatbot. To set up the chatbot:

1. Configure `Cartogo\chatbot\.env`. Use the same `MONGODB_URI` when sharing the MongoDB deployment. Set values explicitly, for example:

   ```dotenv
   MONGODB_URI=your-mongodb-uri
   MONGODB_DATABASE=cartogo
   MONGODB_COLLECTION=chat_logs
   MONGODB_UNITS_DATABASE=Site
   MONGODB_UNITS_COLLECTION=vehicles
   MONGODB_KNOWLEDGE_DATABASE=KB
   MONGODB_KNOWLEDGE_COLLECTION=proprietary_info_collection
   MONGODB_BOT_IDENTITY=bot_identity
   ```

2. Add approved company knowledge documents to `KB.proprietary_info_collection` (or your configured collection). A knowledge document needs a text `content` field; `title`, `topic`, `keywords`, and `tags` improve keyword matching. Add the bot identity document to `KB.bot_identity` (or the collection selected by `MONGODB_BOT_IDENTITY`). It must have `record_id: "cartogo-bot-identity"`, `record_type: "bot_identity"`, and a non-empty `instructions` string containing the complete assistant identity, behavior, safety, and grounding instructions. The chatbot has no local instruction fallback and will return a service error if this record cannot be read. These business records are not automatically seeded.
3. Configure AWS credentials and Bedrock access for the model/region used by the chatbot. Use the repository's AWS login launcher when that is how your environment supplies credentials.
4. From the `Cartogo` directory, start all services with:

   ```powershell
   .\start_cartogo.cmd
   ```

   Or start just the chatbot using `chatbot\start_chat.cmd`. The chatbot launcher prepares its Python environment. Keep the chatbot terminal open while using chat.

The MongoDB initializer creates the chatbot log indexes only when it can read a non-empty MongoDB URI from `chatbot\.env` (or `CHATBOT_MONGODB_URI` in the initializer process). It does not create or populate knowledge records.

## 9. New installation versus existing-data migration

These are different workflows:

- **New installation:** Follow this guide, initialize MongoDB, and add/import fleet and knowledge data as needed. Do not run legacy Supabase table-creation scripts.
- **Existing deployment moved to a new MongoDB host:** Configure both source and destination access, then run the applicable `migrate_supabase_to_mongodb.py`, `migrate_supabase_admin_roles_to_mongodb.py`, and `migrate_supabase_chat_to_mongodb.py` scripts from `main\cartogo-website`. They preserve existing MongoDB records and do not delete the Supabase source data. Run the initializer without `--seed-starter-assets`, verify all required data, and make a recoverable Supabase backup. This repository no longer includes a legacy-table cutover script. If you want legacy tables removed from Supabase, prepare and review a project-specific cleanup only after verifying the imports and backup; keep `cartogo_admin_accounts` and Supabase Auth intact.

Removing the old SQL files from this repository does not run SQL against Supabase or remove any live database records.

## Troubleshooting

- **Initializer says MongoDB URI is not configured:** Confirm `main\cartogo-website\.env` exists, contains `MONGODB_URI=...`, and the command is run from `main\cartogo-website`.
- **MongoDB connection/permission error:** Check the URI, username/password URL encoding, Atlas network allowlist, and read/write permissions for the `cartogo` and `Site` databases.
- **Supabase auth or `UNAUTHORIZED_INVALID_API_KEY`:** Confirm `SUPABASE_URL` and `SUPABASE_ANON_KEY` belong to the same project.
- **Google login returns to an error page:** Check the Google provider callback URL, Supabase Site URL, redirect allowlist, current hostname, and port.
- **Admin page says the account is not authorized:** Run the bootstrap SQL in the same project used by the website, verify the Google account email, and sign in again.
- **Admin can sign in but lacks Owner access:** Confirm `CARTOGO_INITIAL_OWNER_EMAIL` matches the allowlisted account and that the MongoDB role record was not previously assigned a different title.
- **Owner PIN or guest verification email does not arrive:** Check `SMTP_USER`, `SMTP_APP_PASSWORD`, `SMTP_HOST`, `SMTP_PORT`, and `SMTP_FROM`; use a Google app password rather than the normal account password.
- **Inquiry confirmation email is delayed:** The inquiry is saved independently from email delivery. Check the `email_outbox` collection (or the configured `MONGODB_EMAIL_OUTBOX_COLLECTION`) for queued/failed jobs and review the website server log for retry errors.
- **Site content is not initialized:** Rerun the MongoDB initializer and check its output and MongoDB write permissions.
- **Pickup/contact list is empty:** On a blank installation, rerun with `--seed-starter-assets`; the seed only runs if the site-assets collection has no documents. If assets were migrated, verify the configured MongoDB database/collection instead.
- **Chatbot cannot see vehicles:** Check that the chatbot uses `MONGODB_UNITS_DATABASE=Site` and `MONGODB_UNITS_COLLECTION=vehicles`, and that the fleet collection has records.

For the broader site and service behavior, see [`main/cartogo-website/README.md`](../../README.md) and [`chatbot/OPERATIONAL_TUTORIAL.md`](../../../chatbot/OPERATIONAL_TUTORIAL.md).
