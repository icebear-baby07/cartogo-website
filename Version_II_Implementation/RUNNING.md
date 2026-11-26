# Running carTOGO Version II

## Start the website, API, and chatbot

For the easiest full startup on Windows, open the `Version_II_Implementation`
folder in Visual Studio Code, then open its integrated PowerShell terminal.
Before the first run, configure these local files from their `.env.example`
templates:

- `apps/api/.env`: Supabase server settings and SMTP settings if email features
  are needed.
- `apps/website/.env`: the Supabase URL and public anon key.
- `apps/chatbot/.env`: the chatbot's Supabase settings. Bedrock access uses
  AWS credentials, region, and model permissions; the launcher can start AWS
  sign-in, but it does not grant account or model access.

The all-in-one launcher performs AWS sign-in first, then starts the
website/API and chatbot in separate terminals. Run it from the project folder:

```powershell
.\start_cartogo.cmd
```

Complete the AWS browser/device sign-in and wait for confirmation before the
service terminals open. If sign-in fails, the launcher stops without starting
the services. The website launcher installs JavaScript dependencies if
needed; the chatbot launcher creates or repairs the `ctg-venv` environment and
installs its Python requirements, so you do not need to activate that
environment manually. Node.js 22 or newer and Python 3.10 or newer are
required; AWS CLI v2 is needed for sign-in.

If you copied the launcher's full path from File Explorer, run it in
PowerShell with the call operator (replace the example path with the copied
path):

```powershell
& "D:\path\to\Version_II_Implementation\start_cartogo.cmd"
```

If you prefer to start each component manually, first sign in from the project
directory:

```powershell
aws login
```

Follow the AWS CLI prompts. It may open a browser automatically; if it
provides a URL or device code, open the URL and complete the sign-in there.
Wait for the CLI to confirm success before starting either service:

```powershell
npm.cmd run dev
```

Then, in a second terminal, start the chatbot:

```powershell
npm.cmd run dev:chatbot
```

The chatbot uses Amazon Bedrock for generative responses. Without AWS
credentials, requests that need Bedrock return HTTP 503. If credentials are
available but the account lacks access to the configured model or region, the
Bedrock request can fail with HTTP 502. A successful `aws login` session is
cached locally; AWS does not need to print or expose reusable credentials.

The chatbot is at <http://127.0.0.1:8003/>. It binds to all network interfaces
and does not require user authentication; run it only on a trusted network.
The website and API can run without the chatbot; assistant requests will show
an unavailable message until it starts. The agent/contact view is only a local
preview, not a live support queue. To start only the website and API without
AWS sign-in, use `.\start_site.cmd`.

On Linux/macOS, `bash ./start_cartogo.sh` runs AWS sign-in first when the AWS
CLI is installed, then starts the chatbot and website/API. For separate
startup, complete `aws login` first, then run `npm run dev` and
`bash apps/chatbot/start_chat.sh` in separate terminals. The chatbot launcher
creates or repairs `.venv-chatbot` and installs its Python requirements.

For Google/Supabase sign-in from another device, add the exact website URL to
Supabase's allowed redirect URLs as described below. Never put server-only
keys or SMTP credentials in the website environment or commit `.env` files.

## Manual startup: website and API

These steps start only the website and API; they do not require AWS sign-in.
For a full launch with the chatbot, complete the AWS sign-in first using the
sequence above. To locate the project from PowerShell, run the following. If
the terminal is already inside a clone, it searches that clone first.
Otherwise, it searches available drive-letter roots, including drives such as
`D:` and `E:`. The drive search checks up to eight directory levels and skips
common system and dependency-cache folders.

```powershell
$git = Get-Command git.exe -ErrorAction SilentlyContinue
$repoRoot = $null
if ($git) {
  $repoRoot = & $git.Source rev-parse --show-toplevel 2>$null
  if ($LASTEXITCODE -ne 0) {
    $repoRoot = $null
  }
}

$searchRoots = if ($repoRoot) {
  @($repoRoot.Trim())
} else {
  @(Get-PSDrive -PSProvider FileSystem |
    Where-Object { $_.Root -match '^[A-Za-z]:\\$' } |
    Select-Object -ExpandProperty Root)
}

# Search for project folders whose parent is a Git repository.
$maxDepth = 8
$skipFolderNames = @(
  '$Recycle.Bin',
  'AppData',
  'node_modules',
  'ProgramData',
  'Program Files',
  'Program Files (x86)',
  'System Volume Information',
  'Windows',
  '.git'
)
$searchErrors = @()
$pending = New-Object System.Collections.Queue
foreach ($root in $searchRoots) {
  $pending.Enqueue([pscustomobject]@{ Path = $root; Depth = 0 })
}
$found = @()
while ($pending.Count -gt 0) {
  $current = $pending.Dequeue()
  if ($current.Depth -ge $maxDepth) {
    continue
  }
  $children = Get-ChildItem -LiteralPath $current.Path -Directory -Force `
    -ErrorAction SilentlyContinue -ErrorVariable +searchErrors
  foreach ($child in $children) {
    if ($child.Name -eq 'Version_II_Implementation' -and
        (Test-Path -LiteralPath (Join-Path $child.Parent.FullName '.git'))) {
      $found += $child.FullName
      continue
    }
    if ($skipFolderNames -contains $child.Name -or
        ($child.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
      continue
    }
    $pending.Enqueue([pscustomobject]@{
      Path = $child.FullName
      Depth = $current.Depth + 1
    })
  }
}
$projectDirs = @($found | Sort-Object -Unique)

if ($projectDirs.Count -eq 0) {
  if ($searchErrors.Count -gt 0) {
    throw "No project folder was found. Some folders could not be searched; open PowerShell inside the clone and rerun this command."
  }
  throw "No Version_II_Implementation folder inside a Git repository was found on the searched drives."
}
if ($projectDirs.Count -gt 1) {
  Write-Output "Multiple project folders were found:"
  $projectDirs
  throw "Open PowerShell inside the intended clone and rerun this command to select it."
}
if ($searchErrors.Count -gt 0) {
  Write-Warning "Some folders were inaccessible during the search; the matching project was still found."
}

# Change to the unique discovered folder.
Set-Location -LiteralPath $projectDirs[0]
```

On Linux/macOS, run:

```sh
repo_root="$(git rev-parse --show-toplevel)" || {
  echo "Run this from a terminal inside the cloned repository." >&2
  exit 1
}
cd "$repo_root/Version_II_Implementation"
```

If the search finds multiple clones, run the command from inside the clone you
intend to use. Searching across drive roots can take longer than searching
from inside the repository. If the folder is nested deeper than eight levels
or stored inside one of the skipped folders, run the command from inside the
clone.

If dependencies have not been installed yet (or `node_modules` is missing), run:

```powershell
npm.cmd ci
```

`npm.cmd ci` installs the exact dependency versions from the committed lockfile.
On Linux/macOS, use `npm ci`. Then start the API and website together:

```powershell
npm.cmd run dev
```

On Linux/macOS, run `npm run dev`.

Keep that terminal open. The website listens on all network interfaces by
default. Vite prints its available `Network` URL(s); open one of those URLs
from another device on the same network. On the host computer, you can still
use <http://127.0.0.1:5173/>.

Alternatively, run `.\start_site.cmd` from PowerShell or `start_site.cmd` from
Command Prompt. The launcher prints the LAN access port. On both platforms,
Vite prints its `Network` URL with the host's current network IP address. On
Linux/macOS, run the launcher with `bash ./start_site.sh`.

If Windows Firewall asks, allow access only on a trusted private network.
Both devices must be able to reach each other, and network isolation or
firewall rules must not block port `5173`.

To bind only to the local computer instead, set the host before starting:

```powershell
$env:CARTOGO_SITE_HOST = "127.0.0.1"
npm.cmd run dev
```

On Linux/macOS:
```sh
export CARTOGO_SITE_HOST=127.0.0.1
npm run dev
```

Clear the override to return to network binding (PowerShell):

```powershell
Remove-Item Env:CARTOGO_SITE_HOST
```

On Linux/macOS, run `unset CARTOGO_SITE_HOST`.

The API remains bound to `127.0.0.1`; browser API requests pass through the
website's same-origin `/api` proxy.

## Required local configuration

- The API reads Supabase server settings and optional SMTP settings
  from `apps/api/.env`. Use `apps/api/.env.example` as a reference. Supabase
  must be configured and reachable for API readiness and data operations.
- The API uses `SUPABASE_SERVICE_ROLE_KEY` server-side for database access and
  `SUPABASE_ANON_KEY` for Supabase Auth verification. Keep both out of browser
  code; only the browser's public anon key belongs in its environment.
- Keep every `.env` assignment on its own line; do not put multiple
  assignments on one line.
- The browser environment file `apps/website/.env` may contain only
  `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- Public-site photos use the public Supabase Storage bucket
  `cartogo-public-site-images`, with URLs built from `VITE_SUPABASE_URL`.
  This checkout does not include local fallback images; they work only if the
  expected filenames are added under `apps/website/public/images`.
- The website proxies `/api` requests to `http://127.0.0.1:3001`. Start the
  API and website together with `npm.cmd run dev`; running only Vite causes
  API requests to fail.
- Booking email verification requires working API-side SMTP settings.
- Never put SMTP credentials or Supabase service-role keys in the website
  environment or commit any `.env` file.

## Troubleshooting startup

- **`ECONNREFUSED` in the website terminal:** Vite could not connect to the API
  at `127.0.0.1:3001`. Confirm the API process is running in the combined
  `npm.cmd run dev` terminal.
- **The site reports that the API is not ready:** check the API terminal,
  confirm `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set in
  `apps/api/.env`, and confirm the fleet resource is accessible. Other API
  features require their corresponding Supabase tables and RPC functions to
  be provisioned as well.
- **VS Code reports `Cannot find module '@cartogo/contracts'` and implicit
  `any` types for callbacks such as `rule`:** the contracts workspace's
  generated declarations may be missing. From the Version II directory, run:

  ```powershell
  npm.cmd run build --workspace @cartogo/contracts
  ```

  This generates the declarations and usually clears both the missing-module
  error and dependent type diagnostics. The standard `npm.cmd run dev` and
  `npm.cmd run build` commands also build contracts first. If VS Code still
  shows stale diagnostics, run **TypeScript: Restart TS Server** from the
  Command Palette.
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
setting `API_PORT`, but the website's `/api`
proxy is fixed to `127.0.0.1:3001` in `apps/website/vite.config.ts`; update
that configuration too if you change the API port. The chatbot launchers accept
`CARTOGO_CHAT_PORT` for another local port; set `CHATBOT_URL` in
`apps/api/.env` to match.

Google/Supabase sign-in from another device may require adding the exact
network URL to Supabase's allowed redirect URLs. With a changing IP address,
that URL may need updating when the address changes.

## Build

From the Version II directory, run the Windows commands:

```powershell
npm.cmd run build
git diff --check
```

On Linux/macOS, use `npm run build` followed by `git diff --check`.

For chatbot setup details, see
[`apps/chatbot/OPERATIONAL_TUTORIAL.md`](apps/chatbot/OPERATIONAL_TUTORIAL.md).
