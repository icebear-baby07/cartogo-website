# carTOGO.mnl Website

Customer-facing car rental site with fleet information, booking inquiries, and an admin panel.

## Start the website

Requirements: Python 3.10 or newer, a Supabase project, and a MongoDB database reachable by the website server. Guest email verification also requires the SMTP settings in `.env`.

From the `Cartogo` directory, run `start_site.cmd`. On first launch, it creates `main/cartogo-website/.env` from `.env.example` and stops so you can configure it. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and the server-only `MONGODB_URI` before launching the site. The default port is `8002`; the launcher prints local and LAN addresses and updates the PowerShell window title with the current LAN site address.

When launched with `start_site.ps1` (including `start_site.cmd`), the console highlights successful responses in green, redirects in cyan, client errors in yellow, and server errors in red with contrasting text. API errors also print their HTTP category and a sanitized, length-limited detail for troubleshooting. Set `NO_COLOR` to disable status colors.

To start manually, run `python server.py` from `main/cartogo-website`. To start the website, chatbot, and AWS login together, run `start_cartogo.cmd` from the `Cartogo` directory. The chatbot has separate setup instructions in [OPERATIONAL_TUTORIAL.md](../../chatbot/OPERATIONAL_TUTORIAL.md).

The launchers reuse an already-responsive carTOGO server. If a carTOGO `server.py` process owns its configured port but is no longer responding, the launcher restarts only that verified project process. A listener that cannot be identified as this project is left alone and reported as a port conflict.

To use the site from a phone, open the printed LAN URL on a device connected to the same trusted network. The launcher binds to `0.0.0.0` by default so the site is reachable over LAN; allow Python through Windows Firewall on the Private profile if prompted. Use `HOST=127.0.0.1` when access should be limited to this computer. Do not expose this development server directly to the public internet. LAN addresses may change, so update the Supabase redirect settings if the address changes.

## Environment

`.env.example` is the safe template. Keep the real `.env` local; it is ignored by Git. `SUPABASE_URL` and `SUPABASE_ANON_KEY` must come from the same project. The key may be that project's publishable key or legacy anon key. `MONGODB_URI` is used only by the website server and must never be exposed through `/config.js` or browser code. Never put a Supabase service-role key in browser code.

The booking and pickup maps use MapLibre GL JS with Esri World Street Map tiles; booking distance previews and private-vehicle driving routes use OSRM, and location search and destination validation use OpenStreetMap Nominatim. A point must first pass Nominatim's residential-location or accessible-road verification before the map requests or displays its driving route. A live loading indicator shows the current location-verification, nearest-pickup, or route-retrieval stage. During hover, only the route from the verified current point to its nearest pickup area is drawn; it clears when the pointer leaves. A route for a verified selected destination remains visible. No Google Maps account or API key is required. These integrations depend on public third-party services, so review their usage policies before deployment. In particular, the public OSRM demo server has no production SLA; use a managed or self-hosted routing service for production traffic. If OSRM is unavailable or cannot find a route, the booking flow labels the straight-line estimate as an approximate fallback. Nominatim requests are server-side, cached, and throttled; set the optional `GEOCODING_CONTACT_EMAIL` in `.env` to identify the operator in requests.

The server exposes these public settings through `/config.js` and blocks direct requests for dotfiles. Restart the server after changing `.env`.

The booking map verifies selected destinations on the server through OpenStreetMap Nominatim. The supported road-service area is limited to classified locations in Luzon; destinations in Visayas, Mindanao, Palawan, and other island areas requiring a water crossing are rejected with a randomly selected out-of-bounds message. Hover previews outside the supported area do not request an OSRM road route. If a hovered or selected point is not itself a verified residential location or accessible road, OSRM snaps it to the nearest routable road with no distance ceiling; a snapped point is accepted when Nominatim confirms a mapped, accessible road. The map shows the nearest verified road name and the offset distance, and when a selected point is adjusted it shows the original pin, selected pin, and dotted connector. Search results are restricted to the Philippines; selecting one runs the same destination-validation flow. Hovering over the map shows the mapped place name above the distance readout; the name is also shown for a selected destination. Nominatim search and reverse-geocoding requests are cached and spaced to respect the public service's usage policy.

## Supabase and Google sign-in

Use one Supabase project consistently for the site URL, public key, Google provider, and database configuration. A mismatched URL/key pair causes authentication requests to fail.
For the complete fresh-install database script order, see [the database setup guide](back/db/README.md).

1. In Supabase Authentication, enable Google. Create a Web application OAuth client in Google Cloud, then add the callback URL shown in Supabase's Google provider settings to Google's Authorized redirect URIs. Put the Google client ID and secret in Supabase, not in this repository.
2. In the same Supabase project, set the Site URL to a stable canonical site URL, such as the deployed HTTPS site or `http://localhost:8002/front/`. Do not set it to a DHCP-assigned LAN address; Supabase uses the Site URL as a fallback when a requested return URL is not allowlisted.
3. Under Supabase Authentication → URL Configuration → Redirect URLs, allow the exact pages used: `http://localhost:8002/front/index.html`, `http://localhost:8002/front/admin.html`, `http://127.0.0.1:8002/front/index.html`, and `http://127.0.0.1:8002/front/admin.html`, plus the deployed HTTPS pages. For a changing LAN IP in the `192.168.30.x` subnet, add `http://192.168.30.*/front/index.html` and `http://192.168.30.*/front/admin.html`; update the subnet pattern if your router assigns a different subnet. The admin sign-in returns to the same hostname and port currently used in the browser. The Google Cloud callback remains the Supabase callback URL; it is not a site page.
4. Run [01_supabase_admin_accounts.sql](back/db/01_supabase_admin_accounts.sql) in the SQL editor. It creates the administrator allowlist and its authentication/account-management functions; site content, inquiries, chat sessions, and administrator titles/permissions are stored in MongoDB.
5. Bootstrap the first administrator: sign in once at `front/admin.html` with the chosen Google account (access will be denied until it is added), replace the email placeholder in [02_supabase_bootstrap_first_admin.sql](back/db/02_supabase_bootstrap_first_admin.sql), then run that script in the same project's SQL editor. Return to the admin page and sign in again. To add further administrators, have each account complete Google sign-in once, then add its email in Admin Settings. If an earlier version seeded an unintended email into `cartogo_admin_accounts`, remove that account after adding your intended one.

Set `CARTOGO_INITIAL_OWNER_EMAIL` in the website server's `.env` to the verified administrator account that should receive the initial Owner title. New administrator accounts default to Moderator. Moderators can access inquiries, fleet, site assets, site content, and chat; Owners can also manage administrator accounts and titles. Site-content, fleet, site-asset, chat, and title changes require an Owner PIN, which is sent to every MongoDB account with the Owner title.

`cartogo_admin_accounts` and Supabase Auth are required for administrator sign-in. Keep `SUPABASE_SERVICE_ROLE_KEY` configured on the server for approved administrator-account changes; never expose it through `config.js` or browser code. Configure `SMTP_USER`, `SMTP_APP_PASSWORD`, `SMTP_HOST=smtp.gmail.com`, and `SMTP_PORT=587` for Owner PIN delivery.

## MongoDB data

The website stores the fleet in `Site.vehicles`, pickup/contact records in
`Site.site_assets`, public content in `Site.site_content`, administrator roles
in `Site.admin_roles`, chat sessions in `Site.chat_sessions`, and inquiries in
`cartogo.inquiries` by default. The chatbot uses its configured MongoDB
collections for identity, company knowledge, and optional chat logs. Set
database and collection names in each server's local `.env` as needed. The
repository no longer includes one-off data import utilities.

The booking form filters unit choices to capacities no larger than the entered value and offers separate 12/24-hour and custom-day arrangements. Hourly rentals quote one selected rate block; custom rentals use a 4–15 day slider and the 24-hour rate, with configured discounts. Luzon destinations use custom-day rates only. The return date follows the selected arrangement and pickup time. Rates stay hidden until a unit is selected. Customer target coordinates are sent to Nominatim to identify the rate region; follow the OpenStreetMap tile and Nominatim usage policies before scaling production traffic. Keep the required OpenStreetMap attribution visible. Public visitors cannot read rows marked `Inactive`.

Customers can submit inquiries either with Google sign-in or as a guest. Google-authenticated inquiries use the verified Supabase profile; guests must provide first and last names (middle name and suffix are optional), a phone number, and an email address verified by a one-time code sent through SMTP. Every inquiry requires a phone number with 7–15 digits; phone verification is not currently performed. Guest email verification codes expire after ten minutes, allow five attempts, and are rate-limited to one email per minute per client address. After an inquiry is saved, the customer receives a branded HTML and plain-text confirmation summarizing the request and next steps. Delivery failures do not undo a saved inquiry; the site reports that the confirmation email could not be sent, and the server logs the failure. Guest verification, inquiry confirmations, and administrator approval codes share the same branded email template and SMTP settings. If the email-code request returns a 404, restart or update the website server so it includes the email verification API, then refresh the page. Admin inquiry listing, status changes, and deletion require an authorized administrator with the appropriate MongoDB title. Do not expose MongoDB credentials to the browser. If a token request returns `UNAUTHORIZED_INVALID_API_KEY`, verify that the Supabase URL and public key belong to the same project.

Phone numbers are required for booking inquiries, but are not verified.

## Data and security notes

Booking inquiries, including customer-selected target coordinates and quote snapshots, use MongoDB collection `inquiries`; Supabase Auth provides sign-in, while `cartogo_admin_accounts` holds the administrator allowlist. Administrator titles/permissions and chat sessions use MongoDB. Public units, pickup/contact records, rates, page copy, social links, and promo rules use MongoDB. The public Contact map and booking distance calculations use the same pickup locations from MongoDB `site_assets`; hovering or focusing a Contact location highlights its map pin. Rates list all public units without requiring a booking, and fee explanations expand on hover or keyboard focus. The footer insurance CTA links to the live-agent section. The chatbot launcher corner and shape (horizontal, square, or vertical icon-only) are stored in the visitor's browser. Fleet and site-asset writes are performed by the website server only after owner PIN approval.

Chat sessions are stored in MongoDB and are accessed through the website server; chat-session deletion requires an Owner PIN. The chatbot service and its optional MongoDB request logging use separate collections from website inquiries.

## Technical overview

- **Python and the standard-library HTTP server** power the website and chatbot backends. They serve the browser application, expose API endpoints, handle inquiry and chat workflows, and keep database and email operations on the server.
- **HTML, CSS, and browser JavaScript** build the customer-facing site and admin panel. They provide the rental inquiry flow, fleet and rate views, interactive maps, and administration without a separate frontend framework.
- **MongoDB with PyMongo** stores the live vehicle catalog, pickup and contact locations, site content, inquiries, administrator titles/permissions, website chat sessions, chatbot knowledge, and optional chat logs. The website and chatbot use separate collections for their respective data.
- **Supabase Auth and Google OAuth** provide sign-in. The current application uses `cartogo_admin_accounts` as its administrator allowlist; legacy Supabase tables in an existing project are not accessed by the application. The service role is reserved for server-side account management.
- **Amazon Bedrock, accessed through Boto3 in the chatbot**, supplies the AI responses. The chatbot can also look up vehicle availability and use company knowledge stored in MongoDB.
- **SMTP** sends guest email-verification codes, inquiry confirmations, and owner-approval PINs, helping verify guest email ownership and notify customers and administrators.
- **MapLibre GL JS** renders interactive booking and pickup maps using **Esri World Street Map** raster tiles and Esri attribution. **OSRM's driving profile** supplies driving-distance estimates and one displayed road route at a time to the nearest pickup area, with clearly labeled straight-line fallback estimates when distance routing is unavailable. **OpenStreetMap Nominatim** powers server-side location search, destination validation, and mapped place names. These public services have usage policies and availability limits; the OSRM demo server is not intended for production workloads.