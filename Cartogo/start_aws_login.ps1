$ErrorActionPreference = "Continue"
$AwsCli = Get-Command aws.exe -ErrorAction SilentlyContinue

if (-not $AwsCli) {
	Write-Error "AWS CLI was not found. Install AWS CLI v2 and run this launcher again."
	return
}

Write-Host "Starting AWS sign-in. Complete the browser/device verification if prompted."
& $AwsCli.Source login
if ($LASTEXITCODE -eq 0) {
	Write-Host "AWS login completed. The chatbot can now access its configured Bedrock model."
}
else {
	Write-Warning "AWS login did not complete successfully. Check the message above and retry in this window."
}