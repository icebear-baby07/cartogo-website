@echo off
setlocal
set "ROOT=%~dp0"

call "%ROOT%start_aws_login.cmd"
if errorlevel 1 (
  echo AWS sign-in failed. Website/API and chatbot were not started.
  exit /b 1
)

start "carTOGO Version II Website" cmd.exe /k ""%ROOT%start_site.cmd""
start "carTOGO Version II Chatbot" cmd.exe /k ""%ROOT%apps\chatbot\start_chat.cmd""
