@echo off
setlocal
set "ROOT=%~dp0"
cd /d "%ROOT%"
if errorlevel 1 (
  echo Could not open the Version II project folder.
  exit /b 1
)

where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install Node.js 22 or newer and run this launcher again.
  exit /b 1
)
node.exe -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)"
if errorlevel 1 (
  echo Node.js 22 or newer is required. Upgrade Node.js and run this launcher again.
  exit /b 1
)
where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Reinstall Node.js with npm and run this launcher again.
  exit /b 1
)

set "CREATED_ENV="
if not exist "apps\api\.env" (
  copy "apps\api\.env.example" "apps\api\.env" >nul
  if errorlevel 1 (
    echo Could not create apps\api\.env from its example.
    exit /b 1
  )
  set "CREATED_ENV=1"
)
if not exist "apps\website\.env" (
  copy "apps\website\.env.example" "apps\website\.env" >nul
  if errorlevel 1 (
    echo Could not create apps\website\.env from its example.
    exit /b 1
  )
  set "CREATED_ENV=1"
)
if defined CREATED_ENV (
  echo Created missing environment files from their examples.
  echo Configure the values in apps\api\.env and apps\website\.env, then run this launcher again.
  exit /b 1
)

if not exist "node_modules" (
  echo Installing Version II JavaScript dependencies...
  call npm.cmd ci
  if errorlevel 1 exit /b 1
)

echo Starting Version II API and website...
echo LAN access port: 5173. Use the Vite Network URL printed below on other devices on this network.
call npm.cmd run dev
set "EXIT_CODE=%ERRORLEVEL%"
exit /b %EXIT_CODE%
