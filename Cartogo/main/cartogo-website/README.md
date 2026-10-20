# carTOGO.mnl Website

Customer-facing car rental site with fleet information, booking inquiries, and an admin panel.

## Start the website

Requirements: Python 3.10 or newer, a Supabase project, and a MongoDB database reachable by the website server.

From the `Cartogo` directory, run `start_site.cmd`. On first launch, it creates `main/cartogo-website/.env` from `.env.example` and stops so you can configure it. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and the server-only `MONGODB_URI`; follow the migration steps below before launching the cut-over site. The default port is `8002`; the launcher prints local and LAN addresses.

To start manually, run `python server.py` from `main/cartogo-website`. To start the website, chatbot, and AWS login together, run `start_cartogo.cmd` from the `Cartogo` directory. The chatbot has separate setup instructions in [OPERATIONAL_TUTORIAL.md](../../chatbot/OPERATIONAL_TUTORIAL.md).

For phone testing, open the printed LAN URL on a device connected to the same trusted network. The launcher binds to `0.0.0.0` by default so the site is reachable over LAN; allow Python through Windows Firewall on the Private profile if prompted. Use `HOST=127.0.0.1` when access should be limited to this computer. Do not expose this development server directly to the public internet. LAN addresses may change, so update the Supabase redirect settings if the address changes.

## Environment

`.env.example` is the safe template. Keep the real `.env` local; it is ignored by Git. `SUPABASE_URL` and `SUPABASE_ANON_KEY` must come from the same project. The key may be that project's publishable key or legacy anon key. `MONGODB_URI` is used only by the website server and must never be exposed through `/config.js` or browser code. Never put a Supabase service-role key in browser code.

The server exposes these public settings through `/config.js` and blocks direct requests for dotfiles. Restart the server after changing `.env`.

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

Unit changes in Admin → Fleet & Rates and site asset changes in Admin → Site Assets require a one-time approval code sent to the signed-in authorized administrator. The existing Google/Supabase admin authorization remains in place; approved catalog writes now go to MongoDB. Configure `SMTP_USER`, `SMTP_APP_PASSWORD`, `SMTP_HOST=smtp.gmail.com`, and `SMTP_PORT=587` in the ignored website `.env`. Use a Gmail app password (with 2-Step Verification enabled), not the account password. The website no longer needs a Supabase service-role key for catalog edits.

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

After the existing Supabase SQL migrations have been applied and these MongoDB settings are configured, temporarily set `SUPABASE_SERVICE_ROLE_KEY` in the ignored website `.env`, then run the one-time importer from `main/cartogo-website`. The importer needs this server-only key so it can include inactive inventory hidden from public Supabase reads. Remove the key from `.env` after migration if it is not needed by another server process; it is never sent to the browser.

```powershell
py -3 migrate_supabase_to_mongodb.py
```

The importer reads the public `unit_data` and `site_assets` tables, uses their existing numeric IDs, and inserts records only when that ID is not already in MongoDB. It seeds `site_content` from [site_content_seed.json](back/data/site_content_seed.json) only if the public content document is absent. Re-running it will not overwrite MongoDB edits. It does not delete or modify Supabase data. Set the remaining collection names in `.env` if you prefer names other than the defaults above.

The website and chatbot then read the public vehicle catalog from MongoDB collection `vehicles`; pickup/contact locations, discounts, site settings, and page copy are in `site_assets` and `site_content`. The default discount rules are 5% for 4–7 days and 10% for 8–15 days. Footer social entries are placeholder labels (“Facebook Link”, “IG Link”, “X Link”) with no active URL until real profile links are provided. The existing per-browser `localStorage` values are not imported; migration seeds the current source-code defaults. Supabase remains authoritative for Google sign-in/admin authorization and private booking inquiries. A customer-selected target coordinate and quote snapshot remain attached to its inquiry in Supabase; MongoDB stores shared public pickup/location configuration, not customer trip records.

For the chatbot, set the same `MONGODB_URI`, `MONGODB_DATABASE=cartogo`, and `MONGODB_UNITS_COLLECTION=vehicles` in `chatbot/.env`, then restart it. Chat logs and company knowledge use their separately configured MongoDB collections. No Supabase key is needed by the chatbot for vehicle lookup.

The booking form filters unit choices to capacities no larger than the entered value, requires 12/24 hours for IN/OUT, and treats `luzon_rate` as a 24-hour rate. Rental days are selected from 4–15; 24-hour and Luzon quotes receive the MongoDB-configured promo, while 12-hour quotes do not. The return date follows the selected duration. Rates stay hidden until a unit is selected. Customer target coordinates are sent to Nominatim to identify the rate region; follow the OpenStreetMap tile and Nominatim usage policies before scaling production traffic. Keep the required OpenStreetMap attribution visible. Public visitors cannot read rows marked `Inactive`.

Customer inquiries require a verified Google account. Row-level security restricts inquiry access; do not disable it or grant anonymous access to inquiries. If a token request returns `UNAUTHORIZED_INVALID_API_KEY`, verify that the Supabase URL and public key belong to the same project.

## Data and security notes

Booking inquiries, including customer-selected target coordinates and quote snapshots, and Supabase authentication/admin authorization remain in Supabase. Public units, pickup/contact records, site settings, page copy, and promo rules use MongoDB. The public Contact map and booking distance calculations use the same pickup locations from MongoDB `site_assets`; hovering or focusing a Contact location highlights its map pin. Rates list all public units without requiring a booking, and fee explanations expand on hover or keyboard focus. The footer insurance CTA links to the live-agent section. The chatbot launcher corner and shape (horizontal, square, or vertical icon-only) are stored in the visitor's browser. Fleet and site-asset writes are performed by the website server only after admin OTP approval.

The supplied chat schema currently grants anonymous clients broad access to `public.chat_sessions`, including read and delete. Review and tighten those policies before using that schema with real or sensitive conversations in production. The chatbot service and its optional MongoDB request logging are separate from inquiry storage.
