# carTOGO.mnl Website

Customer-facing car rental site with fleet information, booking inquiries, and an admin panel.

## Start the website

Requirements: Python 3.10 or newer and a Supabase project.

From the `Cartogo` directory, run `start_site.cmd`. On first launch, it creates `main/cartogo-website/.env` from `.env.example` and stops so you can configure it. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY`, then run the launcher again. The default port is `8002`; the launcher prints local and LAN addresses.

To start manually, run `python server.py` from `main/cartogo-website`. To start the website, chatbot, and AWS login together, run `start_cartogo.cmd` from the `Cartogo` directory. The chatbot has separate setup instructions in [OPERATIONAL_TUTORIAL.md](../../chatbot/OPERATIONAL_TUTORIAL.md).

For phone testing, open the printed LAN URL on a device connected to the same network. Allow Python through Windows Firewall on the Private profile if prompted. Set `HOST=0.0.0.0` for LAN access; use `127.0.0.1` when access should be limited to this computer. LAN addresses may change, so update the Supabase redirect settings if the address changes.

## Environment

`.env.example` is the safe template. Keep the real `.env` local; it is ignored by Git. `SUPABASE_URL` and `SUPABASE_ANON_KEY` must come from the same project. The key may be that project's publishable key or legacy anon key. Never put a service-role key in this file or browser code.

The server exposes these public settings through `/config.js` and blocks direct requests for dotfiles. Restart the server after changing `.env`.

## Supabase and Google sign-in

Use one Supabase project consistently for the site URL, public key, Google provider, and database migrations. A mismatched URL/key pair causes authentication requests to fail.

1. In Supabase Authentication, enable Google. Create a Web application OAuth client in Google Cloud, then add the callback URL shown in Supabase's Google provider settings to Google's Authorized redirect URIs. Put the Google client ID and secret in Supabase, not in this repository.
2. In the same Supabase project, set the Site URL to a stable canonical site URL, such as the deployed HTTPS site or `http://localhost:8002/front/`. Do not set it to a DHCP-assigned LAN address; Supabase uses the Site URL as a fallback when a requested return URL is not allowlisted.
3. Under Supabase Authentication → URL Configuration → Redirect URLs, allow the exact pages used: `http://localhost:8002/front/index.html`, `http://localhost:8002/front/admin.html`, `http://127.0.0.1:8002/front/index.html`, and `http://127.0.0.1:8002/front/admin.html`, plus the deployed HTTPS pages. For a changing LAN IP in the `192.168.30.x` subnet, add `http://192.168.30.*/front/index.html` and `http://192.168.30.*/front/admin.html`; update the subnet pattern if your router assigns a different subnet. The admin sign-in returns to the same hostname and port currently used in the browser. The Google Cloud callback remains the Supabase callback URL; it is not a site page.
4. Run [supabase-inquiry-migration.sql](back/db/supabase-inquiry-migration.sql) in the SQL editor for inquiry storage, row-level security, and admin authorization. It does not contain an initial administrator email. Run or rerun [unit_data.sql](back/db/unit_data.sql) after it to create or migrate the shared inventory table and public read policy. Existing `daily_rate` values are copied into `in24_rate`; the other four rate columns start at 0, then the old column is dropped. Run [supabase-inquiry-location-migration.sql](back/db/supabase-inquiry-location-migration.sql) to store map target coordinates, nearest pickup, rate region, duration, and quote metadata. Run [supabase-chat-schema.sql](back/db/supabase-chat-schema.sql) only if using the Supabase Chat Monitor.
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

Unit changes in Admin → Fleet & Rates require a one-time approval code sent to the signed-in authorized administrator. In the website server's ignored `main/cartogo-website/.env`, set `SUPABASE_SERVICE_ROLE_KEY` to the service-role key for the same project and configure `SMTP_USER`, `SMTP_APP_PASSWORD`, `SMTP_HOST=smtp.gmail.com`, and `SMTP_PORT=587`. Use a Gmail app password (with 2-Step Verification enabled), not the account password. The service-role key stays on the website server and must never be added to browser config or chatbot settings. Restart the website server after changing `.env`.

The customer fleet and rates now read from `public.unit_data`; add inventory through the authorized admin panel after running the SQL file. `IN` rates are for Metro Manila, `OUT` rates are for neighboring areas, and `luzon_rate` covers other recognized Luzon locations. The booking form classifies the selected map target with OpenStreetMap Nominatim, uses 12/24-hour IN/OUT rates, and treats `luzon_rate` as a 24-hour rate. Target coordinates are sent to Nominatim to identify the rate region; follow the OpenStreetMap tile and Nominatim usage policies before scaling production traffic. Public visitors cannot read rows marked `Inactive`. To ground chatbot answers in live units, set the same project's `SUPABASE_URL` and `SUPABASE_ANON_KEY` in the ignored `chatbot/.env`, then restart the chatbot. The chatbot uses only its read-only key for inventory lookup; if no matching row can be verified, it says so instead of guessing.

Customer inquiries require a verified Google account. Row-level security restricts inquiry access; do not disable it or grant anonymous access to inquiries. If a token request returns `UNAUTHORIZED_INVALID_API_KEY`, verify that the Supabase URL and public key belong to the same project.

## Data and security notes

Inquiries, unit inventory, and chat sessions use Supabase. Site settings and labels still use browser-local storage and are not shared across devices.

The supplied chat schema currently grants anonymous clients broad access to `public.chat_sessions`, including read and delete. Review and tighten those policies before using that schema with real or sensitive conversations in production. The chatbot service and its optional MongoDB request logging are separate from inquiry storage.
