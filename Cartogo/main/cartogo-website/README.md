# carTOGO.mnl Website

Customer-facing car rental site with fleet information, booking inquiries, and an admin panel.

## Start the website

Requirements: Python 3.10 or newer, a Supabase project, and a MongoDB database reachable by the website server. Guest email verification also requires the SMTP settings in `.env`.

From the `Cartogo` directory, run `start_site.cmd`. On first launch, it creates `main/cartogo-website/.env` from `.env.example` and stops so you can configure it. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and the server-only `MONGODB_URI`; follow the migration steps below before launching the cut-over site. The default port is `8002`; the launcher prints local and LAN addresses.

To start manually, run `python server.py` from `main/cartogo-website`. To start the website, chatbot, and AWS login together, run `start_cartogo.cmd` from the `Cartogo` directory. The chatbot has separate setup instructions in [OPERATIONAL_TUTORIAL.md](../../chatbot/OPERATIONAL_TUTORIAL.md).

The launchers reuse an already-responsive carTOGO server. If a carTOGO `server.py` process owns its configured port but is no longer responding, the launcher restarts only that verified project process. A listener that cannot be identified as this project is left alone and reported as a port conflict.

For phone testing, open the printed LAN URL on a device connected to the same trusted network. The launcher binds to `0.0.0.0` by default so the site is reachable over LAN; allow Python through Windows Firewall on the Private profile if prompted. Use `HOST=127.0.0.1` when access should be limited to this computer. Do not expose this development server directly to the public internet. LAN addresses may change, so update the Supabase redirect settings if the address changes.

## Environment

`.env.example` is the safe template. Keep the real `.env` local; it is ignored by Git. `SUPABASE_URL` and `SUPABASE_ANON_KEY` must come from the same project. The key may be that project's publishable key or legacy anon key. `MONGODB_URI` is used only by the website server and must never be exposed through `/config.js` or browser code. Never put a Supabase service-role key in browser code.

The server exposes these public settings through `/config.js` and blocks direct requests for dotfiles. Restart the server after changing `.env`.

The booking map verifies selected destinations on the server through OpenStreetMap Nominatim. A valid pin must resolve to a mapped road and populated neighborhood; water, natural terrain, mapped non-residential sites, and locations without enough map data are rejected. Hovering over the map shows the mapped place name above the distance readout; the name is also shown for a selected destination. Set the optional `GEOCODING_CONTACT_EMAIL` in `.env` to identify an operational contact in Nominatim requests. The server caches results and spaces uncached requests to respect the public service's usage policy.

## Supabase and Google sign-in

Use one Supabase project consistently for the site URL, public key, Google provider, and database migrations. A mismatched URL/key pair causes authentication requests to fail.

1. In Supabase Authentication, enable Google. Create a Web application OAuth client in Google Cloud, then add the callback URL shown in Supabase's Google provider settings to Google's Authorized redirect URIs. Put the Google client ID and secret in Supabase, not in this repository.
2. In the same Supabase project, set the Site URL to a stable canonical site URL, such as the deployed HTTPS site or `http://localhost:8002/front/`. Do not set it to a DHCP-assigned LAN address; Supabase uses the Site URL as a fallback when a requested return URL is not allowlisted.
3. Under Supabase Authentication → URL Configuration → Redirect URLs, allow the exact pages used: `http://localhost:8002/front/index.html`, `http://localhost:8002/front/admin.html`, `http://127.0.0.1:8002/front/index.html`, and `http://127.0.0.1:8002/front/admin.html`, plus the deployed HTTPS pages. For a changing LAN IP in the `192.168.30.x` subnet, add `http://192.168.30.*/front/index.html` and `http://192.168.30.*/front/admin.html`; update the subnet pattern if your router assigns a different subnet. The admin sign-in returns to the same hostname and port currently used in the browser. The Google Cloud callback remains the Supabase callback URL; it is not a site page.
4. Run [supabase-inquiry-migration.sql](back/db/supabase-inquiry-migration.sql) in the SQL editor for inquiry storage, row-level security, and admin authorization. It does not contain an initial administrator email. Run or rerun [unit_data.sql](back/db/unit_data.sql) after it to create or migrate the shared inventory table and public read policy. Existing `daily_rate` values are copied into `in24_rate`; the other four rate columns start at 0, then the old column is dropped. Run [supabase-inquiry-location-migration.sql](back/db/supabase-inquiry-location-migration.sql) to store map target coordinates, nearest pickup, rate region, duration, and quote metadata, then [supabase-inquiry-pricing-migration.sql](back/db/supabase-inquiry-pricing-migration.sql) to save pickup time, rental days, and promo discount details. Run [site_assets.sql](back/db/site_assets.sql) to create and seed the shared pickup locations and live-agent contact record. Run [supabase-chat-schema.sql](back/db/supabase-chat-schema.sql) only if using the Supabase Chat Monitor.
5. Bootstrap the first administrator: sign in once at `front/admin.html` with the chosen Google account (access will be denied until it is added), then run this in the same project's SQL editor after replacing the placeholder with that account's email:

	 ```sql
	 do $$
	 declare
		 bootstrap_email text := lower(trim('YOUR_GOOGLE_EMAIL'));
	 begin
		 if not exists (
			 select 1
			 from auth.users
			 where lower(email) = bootstrap_email
				 and email_confirmed_at is not null
				 and raw_app_meta_data ->> 'provider' = 'google'
		 ) then
			 raise exception 'Complete Google sign-in with this account before adding it as an administrator.';
		 end if;

		 insert into public.cartogo_admin_accounts (admin_email)
		 values (bootstrap_email)
		 on conflict (admin_email) do nothing;
	 end;
	 $$;
	 ```

	 Return to the admin page and sign in again. To add further administrators, have each account complete Google sign-in once, then add its email in Admin Settings. Existing installations migrate their current admin account automatically; if you already ran an earlier version that seeded an email into `cartogo_admin_accounts`, remove that account after adding your intended one.

All Admin changes except the Inquiries tab require a six-digit owner PIN sent to the designated owner email. Apply `back/db/admin_owner_approval.sql` in the Supabase SQL editor after `back/db/supabase-inquiry-migration.sql` and `back/db/supabase-chat-schema.sql` have been applied. The owner migration designates `remuelfernan07@gmail.com`, which must already exist in `cartogo_admin_accounts`, and restricts direct administrator-account changes and chat-session deletions to the server-side service role. The PIN is single-use, expires after five minutes, and approves only the requested change.

Keep `SUPABASE_SERVICE_ROLE_KEY` configured in the ignored website `.env` for owner-approved administrator-account changes and chat-session deletions. It is used only by the server and must never be exposed through `config.js` or browser code. Configure `SMTP_USER`, `SMTP_APP_PASSWORD`, `SMTP_HOST=smtp.gmail.com`, and `SMTP_PORT=587` for owner PIN delivery. Use a Gmail app password (with 2-Step Verification enabled), not the account password. Existing Google/Supabase admin authentication remains required to request or apply a PIN-approved change.

## MongoDB site-data migration

Install the website server's MongoDB driver from `main/cartogo-website`:

```powershell
py -3 -m pip install -r requirements.txt
```

Set these server-only values in `main/cartogo-website/.env`:

- `MONGODB_URI` — connection URI for the MongoDB deployment.
- `MONGODB_DATABASE=cartogo`
- `MONGODB_UNITS_COLLECTION=vehicles`
- `MONGODB_SITE_ASSETS_COLLECTION=site_assets`
- `MONGODB_SITE_CONTENT_COLLECTION=site_content`
- `MONGODB_INQUIRIES_COLLECTION=inquiries`

After the existing Supabase SQL migrations have been applied and these MongoDB settings are configured, ensure `SUPABASE_SERVICE_ROLE_KEY` is set in the ignored website `.env`, then run the one-time importer from `main/cartogo-website`. The importer needs this server-only key so it can include inactive inventory hidden from public Supabase reads. Keep it configured for the owner-approved administrator-account and chat-session operations described above; it is never sent to the browser.

```powershell
py -3 migrate_supabase_to_mongodb.py
```

The importer reads `unit_data`, `site_assets`, and `inquiries` from Supabase in pages, preserves their numeric IDs, and inserts records only when that ID is not already in MongoDB. It seeds `site_content` from [site_content_seed.json](back/data/site_content_seed.json) only if the public content document is absent. Re-running it will not overwrite MongoDB edits; it removes the duplicate `labels.contact` value because pickup/contact data is managed in `site_assets`. Existing Supabase records are never deleted or modified. Set the collection names in `.env` if you prefer names other than the confirmed defaults above.

The website and chatbot read the public vehicle catalog from MongoDB collection `vehicles`; pickup/contact records use `site_assets`; rates, fees, discounts, page copy, and social links use `site_content`; customer inquiries use `inquiries`. The default discount rules are 5% for 4–7 days and 10% for 8–15 days. Footer social entries are placeholder labels (“Facebook Link”, “IG Link”, “X Link”) with no active URL until real profile links are provided. The existing per-browser `localStorage` values are not imported; migration seeds the current source-code defaults. Supabase remains authoritative for Google sign-in and admin authorization. Supabase inquiry rows are copied to MongoDB but retained unchanged in Supabase as a reversible historical copy.

For the chatbot, set the same `MONGODB_URI`, `MONGODB_DATABASE=cartogo`, and `MONGODB_UNITS_COLLECTION=vehicles` in `chatbot/.env`, then restart it. Chat logs and company knowledge use their separately configured MongoDB collections. No Supabase key is needed by the chatbot for vehicle lookup.

The booking form filters unit choices to capacities no larger than the entered value and offers separate 12/24-hour and custom-day arrangements. Hourly rentals quote one selected rate block; custom rentals use a 4–15 day slider and the 24-hour rate, with configured discounts. Luzon destinations use custom-day rates only. The return date follows the selected arrangement and pickup time. Rates stay hidden until a unit is selected. Customer target coordinates are sent to Nominatim to identify the rate region; follow the OpenStreetMap tile and Nominatim usage policies before scaling production traffic. Keep the required OpenStreetMap attribution visible. Public visitors cannot read rows marked `Inactive`.

Customers can submit inquiries either with Google sign-in or as a guest. Google-authenticated inquiries use the verified Supabase profile; guests must provide first and last names (middle name and suffix are optional), a phone number, and an email address verified by a one-time code sent through SMTP. Every inquiry requires a phone number with 7–15 digits; phone verification is not currently performed. Guest email verification codes expire after ten minutes, allow five attempts, and are rate-limited to one email per minute per client address. After an inquiry is saved, the customer receives a branded HTML and plain-text confirmation summarizing the request and next steps. Delivery failures do not undo a saved inquiry; the site reports that the confirmation email could not be sent, and the server logs the failure. Guest verification, inquiry confirmations, and administrator approval codes share the same branded email template and SMTP settings. If the email-code request returns a 404, restart or update the website server so it includes the email verification API, then refresh the page. Admin inquiry listing, status changes, and deletion require an authorized Supabase administrator. Do not expose MongoDB credentials to the browser. Keep Supabase inquiry row-level security enabled for the unchanged source records. If a token request returns `UNAUTHORIZED_INVALID_API_KEY`, verify that the Supabase URL and public key belong to the same project.

> **Soon-to-be-added:** Phone number verification could not be added yet because a free verification provider for sandbox testing is not available. Phone numbers are required for booking inquiries, but are not verified.

## Data and security notes

Booking inquiries, including customer-selected target coordinates and quote snapshots, use MongoDB collection `inquiries`; Supabase authentication/admin authorization remain in Supabase. Public units, pickup/contact records, rates, page copy, social links, and promo rules use MongoDB. The public Contact map and booking distance calculations use the same pickup locations from MongoDB `site_assets`; hovering or focusing a Contact location highlights its map pin. Rates list all public units without requiring a booking, and fee explanations expand on hover or keyboard focus. The footer insurance CTA links to the live-agent section. The chatbot launcher corner and shape (horizontal, square, or vertical icon-only) are stored in the visitor's browser. Fleet and site-asset writes are performed by the website server only after owner PIN approval.

The base chat schema grants anonymous clients broad access to `public.chat_sessions`, including read and delete. Applying `back/db/admin_owner_approval.sql` revokes direct delete access from anonymous and authenticated clients so chat-session deletion must pass through server-side owner approval; the migration does not tighten read access. Review and restrict the remaining chat policies before using that schema with real or sensitive conversations in production. The chatbot service and its optional MongoDB request logging use separate collections from website inquiries.

## Technical overview

- **Python and the standard-library HTTP server** power the website and chatbot backends. They serve the browser application, expose API endpoints, handle inquiry and chat workflows, and keep database and email operations on the server.
- **HTML, CSS, and browser JavaScript** build the customer-facing site and admin panel. They provide the rental inquiry flow, fleet and rate views, interactive maps, and administration without a separate frontend framework.
- **MongoDB with PyMongo** stores the live vehicle catalog, pickup and contact locations, site content, inquiries, chatbot knowledge, and optional chat logs. The website and chatbot use separate collections for their respective data.
- **Supabase and Google OAuth** provide sign-in and administrator authorization. Supabase also holds the existing inquiry source records and access policies; its service role is reserved for server-side operations.
- **Amazon Bedrock, accessed through Boto3 in the chatbot**, supplies the AI responses. The chatbot can also look up vehicle availability and use company knowledge stored in MongoDB.
- **SMTP** sends guest email-verification codes, inquiry confirmations, and owner-approval PINs, helping verify guest email ownership and notify customers and administrators.
- **Leaflet, OpenStreetMap, and Nominatim** support the interactive pickup-location map and geocoding used to determine a booking's rate region and distance. Map and geocoding usage must follow their respective service policies.
- **The Supabase-to-MongoDB migration script** imports the existing catalog, site assets, and inquiries while preserving IDs and avoiding overwrites, enabling the site-data transition without deleting the source records.