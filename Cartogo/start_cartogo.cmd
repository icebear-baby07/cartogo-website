@echo off
setlocal
set "ROOT=%~dp0"
start "AWS Login" "%ROOT%start_aws_login.cmd"
start "carTOGO Website" powershell.exe -NoProfile -ExecutionPolicy Bypass -NoExit -File "%ROOT%start_site.ps1"
start "carTOGO Chatbot" "%ROOT%chatbot\start_chat.cmd"
endlocal