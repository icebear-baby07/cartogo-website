# carTOGO.mnl Website

Customer-facing car rental site with fleet information, booking inquiries, and an admin panel.

## Start the website

Requirements: Python 3.10 or newer and a Supabase project.

From the `Cartogo` directory, run `start_site.cmd`. On first launch, it creates `main/cartogo-website/.env` from `.env.example` and stops so you can configure it. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY`, then run the launcher again. The default port is `8000`; the launcher prints local and LAN addresses.

To start manually, run `python server.py` from `main/cartogo-website`. To start the website, chatbot, and AWS login together, run `start_cartogo.cmd` from the `Cartogo` directory. The chatbot has separate setup instructions in [OPERATIONAL_TUTORIAL.md](../../chatbot/OPERATIONAL_TUTORIAL.md).

For phone testing, open the printed LAN URL on a device connected to the same network. Allow Python through Windows Firewall on the Private profile if prompted. Set `HOST=0.0.0.0` for LAN access; use `127.0.0.1` when access should be limited to this computer. LAN addresses may change, so update the Supabase redirect settings if the address changes.

## Environment

`.env.example` is the safe template. Keep the real `.env` local; it is ignored by Git. `SUPABASE_URL` and `SUPABASE_ANON_KEY` must come from the same project. The key may be that project's publishable key or legacy anon key. Never put a service-role key in this file or browser code.

The server exposes these public settings through `/config.js` and blocks direct requests for dotfiles. Restart the server after changing `.env`.

## Supabase and Google sign-in

Use one Supabase project consistently for the site URL, public key, Google provider, and database migrations. A mismatched URL/key pair causes authentication requests to fail.

1. In Supabase Authentication, enable Google. Create a Web application OAuth client in Google Cloud, then add the callback URL shown in Supabase's Google provider settings to Google's Authorized redirect URIs. Put the Google client ID and secret in Supabase, not in this repository.
2. In the same Supabase project, set the Site URL to the normal deployed site URL. For local LAN testing, it can be set to the current LAN site URL, such as `http://<lan-ip>:<port>/front/`.
3. Add the exact return pages under Supabase Authentication → URL Configuration → Redirect URLs. Include `/front/index.html` and `/front/admin.html` for every address used: `localhost`, `127.0.0.1`, the current LAN IP, and the deployed HTTPS domain as applicable. The app requests a return to the page where sign-in started. The Google Cloud callback remains the Supabase callback URL; it is not a site page.
4. Run [supabase-inquiry-migration.sql](back/db/supabase-inquiry-migration.sql) in the SQL editor for inquiry storage, row-level security, and admin authorization. Review its initial admin email before running it. Run [supabase-chat-schema.sql](back/db/supabase-chat-schema.sql) only if using the Supabase Chat Monitor.
5. Sign in at `front/admin.html` with an authorized Google account. To change the authorized email, first have the new account complete Google sign-in, then update the email in Admin Settings.

Customer inquiries require a verified Google account. Row-level security restricts inquiry access; do not disable it or grant anonymous access to inquiries. If a token request returns `UNAUTHORIZED_INVALID_API_KEY`, verify that the Supabase URL and public key belong to the same project.

## Data and security notes

Inquiries and chat sessions use Supabase. Fleet content is seeded in `back/js/data.js`; site settings use browser-local storage and are not shared across devices.

The supplied chat schema currently grants anonymous clients broad access to `public.chat_sessions`, including read and delete. Review and tighten those policies before using that schema with real or sensitive conversations in production. The chatbot service and its optional MongoDB request logging are separate from inquiry storage.
