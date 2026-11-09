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

The website's chatbot can use its offline preview without this service. To run
the separate chatbot service, open a **second** PowerShell terminal in the same
Version II directory and run:

```powershell
npm.cmd run dev:chatbot
```

The chatbot is at <http://127.0.0.1:8003/>. Its first run may prepare the
separate `ctg-venv` Python environment. Chatbot settings belong in
`apps/chatbot/.env`.

## Required local configuration

- The API reads MongoDB, Supabase server settings, and optional SMTP settings
  from `apps/api/.env`. Use `apps/api/.env.example` as a reference. MongoDB
  must be configured and reachable for the public site to load its fleet and
  content.
- The browser environment file `apps/website/.env` may contain only
  `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- Booking email verification requires working API-side SMTP settings.
- Never put MongoDB credentials, SMTP credentials, or Supabase service-role
  keys in the website environment or commit any `.env` file.

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

## Useful checks

From the Version II directory:

```powershell
npm.cmd test
npm.cmd run build
git diff --check
```

For chatbot setup details, see
[`apps/chatbot/OPERATIONAL_TUTORIAL.md`](apps/chatbot/OPERATIONAL_TUTORIAL.md).
