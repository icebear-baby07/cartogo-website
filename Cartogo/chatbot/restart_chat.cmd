@echo off
setlocal
set "ROOT=%~dp0"
start "carTOGO Website Frontend" powershell.exe -NoProfile -ExecutionPolicy Bypass -NoExit -File "%ROOT%..\start_site.ps1" -Restart
start "carTOGO Chatbot" powershell.exe -NoProfile -ExecutionPolicy Bypass -NoExit -File "%ROOT%start_chat.ps1" -Restart
endlocal