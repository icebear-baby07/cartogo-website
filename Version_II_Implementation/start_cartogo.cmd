@echo off
setlocal
set "ROOT=%~dp0"

start "Version II AWS Login" cmd.exe /k ""%ROOT%start_aws_login.cmd""
start "carTOGO Version II Website" cmd.exe /k ""%ROOT%start_site.cmd""
start "carTOGO Version II Chatbot" cmd.exe /k ""%ROOT%apps\chatbot\start_chat.cmd""
