param(
	[switch]$Restart
)

$ErrorActionPreference = "Stop"

$WorkspaceRoot = $PSScriptRoot
$ProjectRoot = Join-Path $WorkspaceRoot "main\cartogo-website"
$EnvironmentFile = Join-Path $ProjectRoot ".env"
$EnvironmentExample = Join-Path $ProjectRoot ".env.example"

if (-not (Test-Path $EnvironmentFile)) {
	if (-not (Test-Path $EnvironmentExample)) {
		throw "Environment template not found: $EnvironmentExample"
	}
	Copy-Item -LiteralPath $EnvironmentExample -Destination $EnvironmentFile
	throw "Created .env from the template. Set SUPABASE_URL, SUPABASE_ANON_KEY, and MONGODB_URI, migrate the site data, then run this launcher again."
}

$Settings = @{}
foreach ($Line in Get-Content -LiteralPath $EnvironmentFile) {
	if ($Line -match '^\s*([^#=]+?)\s*=\s*(.*?)\s*$') {
		$Name = $Matches[1].Trim()
		$Value = $Matches[2].Trim()
		if ($Value.Length -ge 2 -and $Value[0] -eq $Value[$Value.Length - 1] -and $Value[0] -in @('"', "'")) {
			$Value = $Value.Substring(1, $Value.Length - 2)
		}
		$Settings[$Name] = $Value
	}
}

$SupabaseUrl = $Settings["SUPABASE_URL"]
$SupabaseKey = $Settings["SUPABASE_ANON_KEY"]
if ($SupabaseUrl -notmatch '^https://[a-z0-9-]+\.supabase\.co$' -or -not $SupabaseKey -or $SupabaseKey -match 'your-|placeholder') {
	throw "Set a valid SUPABASE_URL and SUPABASE_ANON_KEY in $EnvironmentFile. Use only a publishable/anon key here."
}
if (-not $Settings["MONGODB_URI"] -or $Settings["MONGODB_URI"] -match 'your-|placeholder') {
	throw "Set the server-only MONGODB_URI in $EnvironmentFile before starting the MongoDB-backed site."
}

$HostName = if ($Settings["HOST"]) { $Settings["HOST"] } else { "0.0.0.0" }
try {
	$Port = [int]$Settings["PORT"]
}
catch {
	throw "PORT in $EnvironmentFile must be a number."
}
if ($Port -lt 1024 -or $Port -gt 65535) {
	throw "PORT in $EnvironmentFile must be between 1024 and 65535."
}

$Listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($Listener) {
	$IsExpectedSite = $false
	try {
		$ExistingSite = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/config.js" -UseBasicParsing -TimeoutSec 3
		$IsExpectedSite = $ExistingSite.StatusCode -eq 200 -and $ExistingSite.Content.Contains($SupabaseUrl)
	}
	catch {
	}

	if ($IsExpectedSite) {
		if ($Restart) {
			$ExistingProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($Listener.OwningProcess)"
			$ServerScript = [System.IO.Path]::GetFullPath((Join-Path $ProjectRoot "server.py"))
			if (-not $ExistingProcess -or [string]::IsNullOrEmpty($ExistingProcess.CommandLine) -or $ExistingProcess.CommandLine.IndexOf($ServerScript, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
				throw "Refusing to stop the listener on port $Port because it could not be identified as the website's server.py."
			}

			Write-Host "Stopping the current website process on port $Port..."
			Stop-Process -Id $Listener.OwningProcess -Force
			try {
				Wait-Process -Id $Listener.OwningProcess -Timeout 10 -ErrorAction Stop
			}
			catch {
			}
			$Listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
			if ($Listener) {
				throw "The website process did not release port $Port. Stop it manually before restarting."
			}
		}
		else {
			Write-Host "Website is already running at http://127.0.0.1:$Port/front/"
			exit 0
		}
	}
	else {
		throw "Website port $Port is already in use by a different project."
	}
}

$Launcher = Get-Command py.exe -ErrorAction SilentlyContinue
if ($Launcher) {
	$PythonPath = & $Launcher.Source -3 -c "import sys; print(sys.executable)" 2>$null
	if ($LASTEXITCODE -ne 0) { $PythonPath = $null }
}
if (-not $PythonPath) {
	$PythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
	if ($PythonCommand) {
		$PythonPath = & $PythonCommand.Source -c "import sys; print(sys.executable)" 2>$null
	}
}
if (-not $PythonPath -or $LASTEXITCODE -ne 0) {
	throw "Python 3 is required. Install Python and enable the py launcher, then run this script again."
}
$PythonPath = ([string]$PythonPath).Trim()
$PythonVersion = & $PythonPath -c "import sys; print(sys.version_info.major * 100 + sys.version_info.minor)"
if ($LASTEXITCODE -ne 0 -or [int]$PythonVersion -lt 310) {
	throw "Python 3.10 or newer is required. Found version code: $PythonVersion"
}
$MongoDriverAvailable = & $PythonPath -c "import pymongo" 2>$null
if ($LASTEXITCODE -ne 0) {
	throw "The MongoDB driver is missing. From main/cartogo-website, run: py -3 -m pip install -r requirements.txt"
}

$PreviousHost = $env:HOST
$PreviousPort = $env:PORT
$env:HOST = $HostName
$env:PORT = [string]$Port
$LanAddresses = @(
	Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
	Where-Object {
		$_.IPAddress -ne "127.0.0.1" -and
		$_.IPAddress -notlike "169.254.*" -and
		$_.AddressState -eq "Preferred"
	} |
	Select-Object -ExpandProperty IPAddress -Unique
)
Write-Host "Local access: http://127.0.0.1:$Port/front/"
foreach ($Address in $LanAddresses) {
	Write-Host "LAN access: http://${Address}:$Port/front/"
}
if ($LanAddresses.Count -eq 0) {
	Write-Warning "No LAN IPv4 address detected. Connect this computer to a network to allow other devices to connect."
}
Write-Host "Allow Python through Windows Firewall on private networks if prompted."
Write-Host "Press Ctrl+C to stop the website server."
Push-Location $ProjectRoot
try {
	& $PythonPath (Join-Path $ProjectRoot "server.py")
	$ServerExitCode = $LASTEXITCODE
}
finally {
	Pop-Location
	if ($null -eq $PreviousHost) { Remove-Item Env:HOST -ErrorAction SilentlyContinue } else { $env:HOST = $PreviousHost }
	if ($null -eq $PreviousPort) { Remove-Item Env:PORT -ErrorAction SilentlyContinue } else { $env:PORT = $PreviousPort }
}

if ($ServerExitCode -ne 0) {
	exit $ServerExitCode
}