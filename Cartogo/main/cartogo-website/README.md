# carTOGO.mnl — Car Rental Website

A red-themed car rental website for carTOGO.mnl with a customer-facing fleet, reservation inquiry form, pricing table, FAQ, contact section, and browser-based admin panel.

## Fleet
- Honda City — Ignited Red Metallic
- Mitsubishi Mirage G4 — Red
- Mitsubishi Mirage G4 — Silver
- Toyota Fortuner

Vehicle photos are stored in `assets/photos/` and are connected to the fleet cards. The rates in `back/js/data.js` are starter values; update them in the Admin panel to your actual carTOGO.mnl rates before publishing.

## Run locally

From the workspace root, double-click `start_cartogo.cmd`. It opens separate terminals for AWS sign-in, the website, and `chatbot/start_chat.cmd`. Both services bind for LAN access and print their LAN URLs. The service launchers detect an existing server and avoid starting duplicates. Allow Python through Windows Firewall on private networks if prompted.

To start only the website, double-click the root `start_site.cmd`. It validates `main/cartogo-website/.env`, checks Python and the configured port, then starts `main/cartogo-website/server.py`.

To start only the chatbot, double-click `chatbot/start_chat.cmd`. It creates/checks the isolated Python environment, installs dependencies, and starts the service on port `8001` by default. MongoDB logging is optional. Set `CARTOGO_CHAT_PORT` and update `CHATBOT_PORT` in `main/cartogo-website/back/js/chatbot.js` together if that port is occupied. The site embeds the chatbot at that port. This local setup uses HTTP; production deployments must serve both origins securely and configure the chatbot URL accordingly.

## Admin
Open `front/admin.html` and sign in with Google. Only the authorized admin email can read customer contact details or update inquiry statuses. To replace the allowlisted email, the new address must complete Google sign-in once; the current admin then adds it in Settings, and the new address signs in again to access the inbox.

## Supabase setup

1. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `.env` to the active project's values. Start the site with `python server.py`; it exposes only those public settings through `/config.js` and blocks direct `.env` requests. Never put a service-role key in `.env` or browser code.
2. Run [supabase-inquiry-migration.sql](back/db/supabase-inquiry-migration.sql) in the Supabase SQL editor. It creates/extends `public.inquiries`, enables row-level security, seeds `remuelfernan07@gmail.com` as the initial admin, and limits inquiry reads/updates to that Google-authenticated admin.
3. In Supabase Authentication, enable the Google provider and leave Phone sign-in disabled; no SMS provider is needed. Configure a Google OAuth client in Google Cloud and enter its client ID/secret in Supabase, using the Supabase callback URL shown in the Google provider settings as the Google OAuth redirect URI. In Supabase URL Configuration, set Site URL to the real deployed site URL (not `http://localhost:3000`); for local testing, the app returns to the exact URL used to open it. Add these local URLs to Redirect URLs: `http://localhost:8002/front/index.html`, `http://localhost:8002/front/admin.html`, `http://127.0.0.1:8002/front/index.html`, and `http://127.0.0.1:8002/front/admin.html`. To sign in from a phone, also add the computer's exact LAN URLs, for example `http://192.168.1.20:8002/front/index.html` and `http://192.168.1.20:8002/front/admin.html` (replace the IP with the LAN URL printed by `start_site.ps1`). Add production URLs before deployment.
4. Inquiries now require a verified Google account and are stored as `confirmed`; no SMS provider or phone OTP is used. Customers may optionally provide a contact phone number, which is not verified. The AWS SMS hook in [Supabase SMS Hook on AWS SNS](../../aws/supabase-sms-hook/README.md) is only needed if phone OTP is enabled again later.
5. Open Admin Settings to replace the initial admin email if needed. The change is authorized by the current admin session; the new email must first complete Google sign-in once, then the current admin can add it in Settings.

The customer browser uses Supabase Auth and the project's public key. RLS, not hidden UI or a browser password, enforces access. Do not disable RLS or grant anonymous reads on inquiries. The SQL migration replaces existing policies on `public.inquiries` with the verified-customer/admin rules.

The chatbot remains a separate service. Its optional MongoDB collection stores request logs; Supabase `inquiries` stores booking requests and customer contact details. The chatbot's Supabase Chat Monitor remains separate from this inquiry workflow.

## Important
Fleet settings and labels still use browser `localStorage`; inquiries are stored in Supabase. The configured project endpoint now responds, but the read-only inquiry check returned `PGRST205` because `public.inquiries` is not in the project's schema cache yet. Run the migration above before testing orders. Google OAuth still requires dashboard configuration.
