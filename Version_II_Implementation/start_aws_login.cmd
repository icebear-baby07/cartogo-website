@echo off
setlocal
where aws.exe >nul 2>nul
if errorlevel 1 (
  echo AWS CLI was not found. Install AWS CLI v2 to use the Bedrock chatbot.
  exit /b 1
)

echo Starting AWS sign-in. Complete the browser/device verification if prompted.
aws.exe login
if errorlevel 1 (
  echo AWS login did not complete successfully. Check the message above and retry.
  exit /b 1
)
echo AWS login completed.
