$ErrorActionPreference = "Stop"

function Resolve-SystemPython {
	$Launcher = Get-Command py.exe -ErrorAction SilentlyContinue
	if ($Launcher) {
		$Candidate = & $Launcher.Source -3 -c "import sys; print(sys.executable)" 2>$null
		if ($LASTEXITCODE -eq 0 -and $Candidate) {
			return ([string]$Candidate).Trim()
		}
	}

	$Command = Get-Command python.exe -ErrorAction SilentlyContinue
	if ($Command) {
		$Candidate = & $Command.Source -c "import sys; print(sys.executable)" 2>$null
		if ($LASTEXITCODE -eq 0 -and $Candidate) {
			return ([string]$Candidate).Trim()
		}
	}

	throw "Python 3.10 or newer is required. Install Python and enable the py launcher, then run this script again."
}

$ProjectRoot = $PSScriptRoot
$RequirementsFile = Join-Path $ProjectRoot "requirements.txt"
$EnvironmentPath = Join-Path $ProjectRoot ".chat-venv"
$EnvironmentPython = Join-Path $EnvironmentPath "Scripts\python.exe"
$Port = if ($env:CARTOGO_CHAT_PORT) { [int]$env:CARTOGO_CHAT_PORT } else { 8001 }
if ($Port -lt 1024 -or $Port -gt 65535) {
	throw "CARTOGO_CHAT_PORT must be between 1024 and 65535."
}

$Listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($Listener) {
	try {
		$ExistingChat = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 3
		if ($ExistingChat.StatusCode -eq 200 -and $ExistingChat.Content.Contains("<title>Cartogo | Chat</title>")) {
			Write-Host "Chatbot is already running at http://127.0.0.1:$Port"
			exit 0
		}
	}
	catch {
		throw "Chatbot port $Port is already in use. Set CARTOGO_CHAT_PORT to an available port and update CHATBOT_PORT in main/cartogo-website/back/js/chatbot.js."
	}
	throw "Chatbot port $Port is already in use by another service."
}

if (-not (Test-Path $RequirementsFile)) {
	throw "Dependency file not found: $RequirementsFile"
}

$SystemPython = Resolve-SystemPython
$PythonVersion = & $SystemPython -c "import sys; print(sys.version_info.major * 100 + sys.version_info.minor)"
if ($LASTEXITCODE -ne 0 -or [int]$PythonVersion -lt 310) {
	throw "Python 3.10 or newer is required. Found version code: $PythonVersion"
}

$EnvironmentReady = $false
if (Test-Path $EnvironmentPython) {
	try {
		& $EnvironmentPython -c "import sys" 2>$null
		$EnvironmentReady = $LASTEXITCODE -eq 0
	}
	catch {
		$EnvironmentReady = $false
	}
}

if (-not $EnvironmentReady) {
	if (Test-Path $EnvironmentPath) {
		$BackupPath = "$EnvironmentPath.repair-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
		Move-Item -LiteralPath $EnvironmentPath -Destination $BackupPath
		Write-Warning "Saved the unusable environment to $BackupPath"
	}

	Write-Host "Creating an isolated Python environment..."
	& $SystemPython -m venv $EnvironmentPath
	if ($LASTEXITCODE -ne 0) {
		throw "Could not create the project Python environment."
	}
}

& $EnvironmentPython -m pip --version *> $null
if ($LASTEXITCODE -ne 0) {
	Write-Host "Installing pip in the project environment..."
	& $EnvironmentPython -m ensurepip --upgrade
	if ($LASTEXITCODE -ne 0) {
		throw "Could not install pip in the project environment."
	}
}

Write-Host "Checking and installing required Python packages..."
& $EnvironmentPython -m pip install -r $RequirementsFile
if ($LASTEXITCODE -ne 0) {
	throw "Dependency installation failed. Check your internet connection and try again."
}

& $EnvironmentPython -c "import boto3, awscrt, dns, dotenv, pymongo; print('Verified boto3 ' + boto3.__version__ + ', awscrt, dnspython, python-dotenv, and pymongo ' + pymongo.version)"
if ($LASTEXITCODE -ne 0) {
	throw "Required Python modules could not be imported after installation."
}

$EnvironmentFile = Join-Path $ProjectRoot ".env"
$EnvironmentExample = Join-Path $ProjectRoot ".env.example"
if (-not (Test-Path $EnvironmentFile) -and (Test-Path $EnvironmentExample)) {
	Copy-Item -LiteralPath $EnvironmentExample -Destination $EnvironmentFile
	Write-Warning "Created .env. Add your MongoDB connection string there to enable chat logging."
}

$Listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($Listener) {
	throw "Chatbot port $Port is already in use. Set CARTOGO_CHAT_PORT to a free port and update CHATBOT_PORT in main/cartogo-website/back/js/chatbot.js."
}

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

Write-Host "Local access: http://127.0.0.1:$Port"
if ($LanAddresses.Count -gt 0) {
	foreach ($Address in $LanAddresses) {
		Write-Host "LAN access: http://${Address}:$Port"
	}
}
else {
	Write-Warning "No LAN IPv4 address was detected. Other devices will not be able to connect until this computer joins an IPv4 network."
}
Write-Host "Press Ctrl+C to stop the server."

Push-Location $ProjectRoot
try {
	& $EnvironmentPython (Join-Path $ProjectRoot "server.py")
	$ServerExitCode = $LASTEXITCODE
}
finally {
	Pop-Location
	Remove-Item Env:PORT -ErrorAction SilentlyContinue
}

if ($ServerExitCode -ne 0) {
	exit $ServerExitCode
}
