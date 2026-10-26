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
	$ExistingProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($Listener.OwningProcess)"
	$ServerScript = [System.IO.Path]::GetFullPath((Join-Path $ProjectRoot "server.py"))
	$IsOwnedWebsite = $ExistingProcess -and
		-not [string]::IsNullOrEmpty($ExistingProcess.CommandLine) -and
		$ExistingProcess.CommandLine.IndexOf($ServerScript, [StringComparison]::OrdinalIgnoreCase) -ge 0
	$IsExpectedSite = $false
	try {
		$ExistingSite = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/config.js" -UseBasicParsing -TimeoutSec 3
		$IsExpectedSite = $ExistingSite.StatusCode -eq 200 -and $ExistingSite.Content.Contains($SupabaseUrl)
	}
	catch {
	}

	if ($IsExpectedSite -and -not $Restart) {
		Write-Host "Website is already running at http://127.0.0.1:$Port/front/"
		exit 0
	}
	elseif ($IsOwnedWebsite) {
		if ($Restart) {
			Write-Host "Restarting the current website process on port $Port..."
		}
		else {
			Write-Host "The website process on port $Port was unresponsive. Restarting this verified Cartogo process..."
		}
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
		throw "Website port $Port is already in use by a different project. The listener was not stopped."
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
$PreviousWindowTitle = $Host.UI.RawUI.WindowTitle
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
if ($LanAddresses.Count -eq 0) {
	Write-Warning "No LAN IPv4 address detected. Connect this computer to a network to allow other devices to connect."
	$SiteHeaderAddress = "http://127.0.0.1:$Port"
}
else {
	$SiteHeaderAddress = "http://$($LanAddresses[0]):$Port"
}
$Host.UI.RawUI.WindowTitle = "carTOGO Website - $SiteHeaderAddress"
Write-Host "Allow Python through Windows Firewall on private networks if prompted."
Write-Host "Starting the website server. Its local and LAN URLs will appear below."

function Write-ServerOutputLine {
	param([object]$OutputLine)

	$Text = [string]$OutputLine
	$StatusMatch = [regex]::Match($Text, 'HTTP/\d(?:\.\d)?["'']?\s+(?<Status>\d{3})')
	if (-not $StatusMatch.Success -or $env:NO_COLOR) {
		Write-Host $Text
		return
	}

	$StatusCode = [int]$StatusMatch.Groups["Status"].Value
	$StatusColor = switch ($StatusCode) {
		{ $_ -lt 300 } { @{ Foreground = "Black"; Background = "Green" }; break }
		{ $_ -lt 400 } { @{ Foreground = "Black"; Background = "Cyan" }; break }
		{ $_ -lt 500 } { @{ Foreground = "Black"; Background = "Yellow" }; break }
		default { @{ Foreground = "White"; Background = "Red" } }
	}
	$StatusGroup = $StatusMatch.Groups["Status"]
	$Prefix = $Text.Substring(0, $StatusGroup.Index)
	$Suffix = $Text.Substring($StatusGroup.Index + $StatusGroup.Length)
	Write-Host $Prefix -NoNewline
	Write-Host $StatusGroup.Value -NoNewline -ForegroundColor $StatusColor.Foreground -BackgroundColor $StatusColor.Background
	Write-Host $Suffix
}

Push-Location $ProjectRoot
try {
	& $PythonPath -u (Join-Path $ProjectRoot "server.py") | ForEach-Object {
		Write-ServerOutputLine $_
	}
	$ServerExitCode = $LASTEXITCODE
}
finally {
	Pop-Location
	$Host.UI.RawUI.WindowTitle = $PreviousWindowTitle
	if ($null -eq $PreviousHost) { Remove-Item Env:HOST -ErrorAction SilentlyContinue } else { $env:HOST = $PreviousHost }
	if ($null -eq $PreviousPort) { Remove-Item Env:PORT -ErrorAction SilentlyContinue } else { $env:PORT = $PreviousPort }
}

if ($ServerExitCode -ne 0) {
	exit $ServerExitCode
}