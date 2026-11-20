# Running carTOGO Version II

## Start the website and API

Open PowerShell in:

```text
D:\cartogo-jr\cartogo-website\Version_II_Implementation
```

Or navigate there with:

```powershell
Set-Location 'D:\cartogo-jr\cartogo-website\Version_II_Implementation'
```

If dependencies have not been installed yet (or `node_modules` is missing), run:

```powershell
npm.cmd install
```

Then start the API and website together:

```powershell
npm.cmd run dev
```

Keep that terminal open. The website listens on all network interfaces by
default. Vite prints its available `Network` URL(s); open one of those URLs
from another device on the same network. On the host computer, you can still
use <http://127.0.0.1:5173/>.

The Windows `start_site.cmd` launcher also prints `LAN access port: 5173`;
the Vite `Network` URL immediately below it includes the host's current
network IP address.

If Windows Firewall asks, allow access only on a trusted private network.
Both devices must be able to reach each other, and network isolation or
firewall rules must not block port `5173`.

To bind only to the local computer instead, set the host before starting:

```powershell
$env:CARTOGO_SITE_HOST = "127.0.0.1"
npm.cmd run dev
```

Clear the override to return to network binding:

```powershell
Remove-Item Env:CARTOGO_SITE_HOST
```

The API remains bound to `127.0.0.1`; browser API requests pass through the
website's same-origin `/api` proxy.

## Start the chatbot (optional)

The website and API can run without the separate chatbot, but assistant
requests will display an unavailable message until the chatbot is started.
The agent/contact view is only a local preview, not a live support queue. To
run the chatbot, open a **second** PowerShell terminal in the same Version II
directory and run:

```powershell
npm.cmd run dev:chatbot
```

The chatbot is at <http://127.0.0.1:8003/>. Its first run may prepare the
separate `ctg-venv` Python environment. Chatbot settings belong in
`apps/chatbot/.env`.

## Required local configuration

- The API reads MongoDB, Supabase server settings, and optional SMTP settings
  from `apps/api/.env`. Use `apps/api/.env.example` as a reference. MongoDB
  must be configured and reachable for the API readiness check and public site
  startup, even if individual API data areas are set to use Supabase.
- API storage selectors accept only `mongodb` or `supabase`. Keep every
  `.env` assignment on its own line; do not put multiple assignments on one
  line.
- The browser environment file `apps/website/.env` may contain only
  `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- Public-site photos use the public Supabase Storage bucket
  `cartogo-public-site-images`, with URLs built from `VITE_SUPABASE_URL`.
  Local fallback photos work only if the expected image filenames are present
  in `apps/website/public/images`.
- The website proxies `/api` requests to `http://127.0.0.1:3001`. Start the
  API and website together with `npm.cmd run dev`; running only Vite causes
  API requests to fail.
- Booking email verification requires working API-side SMTP settings.
- Never put MongoDB credentials, SMTP credentials, or Supabase service-role
  keys in the website environment or commit any `.env` file.

## Troubleshooting startup

- **`ECONNREFUSED` in the website terminal:** Vite could not connect to the API
  at `127.0.0.1:3001`. Confirm the API process is running in the combined
  `npm.cmd run dev` terminal.
- **API exits with a storage-selector error:** check each `*_STORAGE` setting
  in `apps/api/.env`; values must be `mongodb` or `supabase`, with one
  assignment per line.
- **The site reports that the API is not ready:** check the API terminal and
  confirm `MONGODB_URI` points to a reachable, authorized MongoDB deployment.
  The readiness endpoint checks MongoDB even if the API's data providers are
  configured to use Supabase.
- After editing environment files, restart the affected service so it reloads
  the settings. Do not paste credentials into logs, chat, or screenshots.

## Ports and stopping

| Service | Default URL |
| --- | --- |
| Website on this computer | <http://127.0.0.1:5173/> |
| API | <http://127.0.0.1:3001/> |
| Chatbot (optional) | <http://127.0.0.1:8003/> |

For other devices, use a `Network` URL printed by Vite (the host's current
LAN IP address is included there). The address may change when the host joins
a different network or receives a new DHCP address; restart the dev server
and use its updated URL.

Press **Ctrl+C** in each service terminal to stop that service. The website
uses strict port `5173`; if it is occupied, inspect the existing listener
rather than stopping an unknown process. The API can use another port by
setting `API_PORT`, but update the website's `/api` proxy in
`apps/website/vite.config.ts` to match.

Google/Supabase sign-in from another device may require adding the exact
network URL to Supabase's allowed redirect URLs. With a changing IP address,
that URL may need updating when the address changes.

## Build

From the Version II directory:

```powershell
npm.cmd run build
git diff --check
```

For chatbot setup details, see
[`apps/chatbot/OPERATIONAL_TUTORIAL.md`](apps/chatbot/OPERATIONAL_TUTORIAL.md).
