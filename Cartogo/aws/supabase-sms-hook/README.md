# Supabase SMS Hook on AWS SNS

This moves only OTP delivery to AWS. Supabase still creates and verifies phone OTPs and stores inquiries. Supabase calls a signed HTTP Auth Hook; AWS Lambda verifies the signature and asks Amazon SNS to send the message. AWS credentials stay on the Lambda execution role and never enter the website.

The Send SMS Auth Hook is available on Supabase Free and Pro. Amazon SNS SMS is pay-per-message; AWS promotional credits may cover eligible charges, but SNS's free tier for push notifications does not make SMS free. Check the terms of your credits and the Philippines SMS price before proceeding.

## 1. Prepare AWS and Supabase

1. In AWS, choose the account and region where you want to send SMS. SMS sandbox status and spending limits are region-specific.
2. Confirm the AWS CLI is available in PowerShell with `aws --version`. This workspace has AWS CLI installed, but SAM CLI was not detected.
3. Install the [AWS SAM CLI for Windows](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html), then open a new PowerShell window and verify `sam --version`.
4. Sign in to AWS. The workspace's `Cartogo\start_aws_login.cmd` launcher runs `aws login`; complete the browser sign-in. Confirm the expected AWS identity with `aws sts get-caller-identity`. Do not paste credentials or command output containing account details into chat.
5. In Supabase, enable **Authentication → Providers → Phone**. The hook replaces the SMS sender, not Supabase's OTP generation or verification.

## 2. Run the local tests

These tests mock SNS and do not send messages. From the `Cartogo` folder, use the workspace's chatbot virtual environment if it exists:

```powershell
& .\chatbot\.chat-venv\Scripts\python.exe -m unittest discover -s .\aws\supabase-sms-hook\tests -v
```

If that environment is unavailable, run the same command with a Python environment that has `boto3` installed. No AWS credentials are needed for these tests.

## 3. Deploy the Lambda

In PowerShell, change to the hook folder and deploy the SAM template:

```powershell
Set-Location .\aws\supabase-sms-hook
sam build
sam deploy --guided
```

During the guided deployment:

- Choose a clear stack name, such as `cartogo-supabase-sms-hook`.
- Choose the AWS region selected in Step 1.
- Leave `SmsSenderId` blank unless AWS has approved a sender ID for your account and destination.
- Allow SAM to create the Lambda execution role and acknowledge the IAM capabilities prompt. The role grants this function `sns:Publish` only.
- Save the non-secret deployment settings when prompted.

The template creates the Lambda and a public Function URL. The URL is protected by Supabase's signed webhook verification; it is not protected by AWS IAM because Supabase cannot sign AWS IAM requests. In the AWS Lambda console, open the function created by this stack and copy its **Function URL**.

## 4. Connect the Supabase Auth Hook

1. In Supabase, open **Authentication → Hooks** and create an HTTP **Send SMS** hook.
2. Paste the Lambda Function URL as the endpoint. Copy the generated signing secret exactly; it starts with `v1,whsec_`.
3. In AWS Lambda, open the function's **Configuration → Environment variables** and add `SUPABASE_SMS_HOOK_SECRET` with the complete signing secret, including the prefix. Save the change.
4. Do not test the booking form until the Lambda environment variable is saved. Do not commit this secret, put it in `.env`, or send it in chat. The Lambda code does not contain AWS access keys.

## 5. Test in the SNS sandbox

1. In the AWS console, open [AWS End User Messaging SMS](https://console.aws.amazon.com/sms-voice/) in the **same region** as the Lambda. Check the SMS sandbox status and monthly spend limit. In sandbox, AWS allows up to 10 verified destinations and limits SMS spend to $1 per month.
2. Before verifying a destination, AWS requires an active SMS-capable origination identity. The [AWS country support table](https://docs.aws.amazon.com/sms-voice/latest/userguide/phone-numbers-sms-by-country.html) lists Philippines sender IDs as **registration required**; it also says Philippine long codes are inbound-only. Follow the [Philippines sender ID registration guide](https://docs.aws.amazon.com/sms-voice/latest/userguide/registrations-philippines.html). AWS requires carrier authorization documents for Globe and Smart. Wait for the registration status to become **Complete**, then use that approved sender ID. Do not set `SmsSenderId` to an unapproved value.
3. In AWS End User Messaging SMS, open **Sandbox → Verified destination phone numbers** and add your own number in E.164 format, for example `+639XXXXXXXXX`. Request the verification text, then enter the code in the console. AWS's [sandbox instructions](https://docs.aws.amazon.com/sms-voice/latest/userguide/verify-destination-phone-number.html) cover the current screens. If AWS cannot send the verification code, stop here and resolve the origination identity or country-registration requirement before testing the site.
4. Submit a guest inquiry using that verified number. The site accepts either `09XXXXXXXXX` or `+639XXXXXXXXX` and sends the normalized E.164 number to Supabase. If delivery succeeds, enter the OTP and confirm the inquiry appears with `pending_review` status.
5. If delivery fails, inspect Supabase Auth logs and the Lambda's CloudWatch log group. The function intentionally does not log OTPs or destination numbers. SNS accepting a publish request does not guarantee carrier delivery; use AWS SMS delivery/usage reports to investigate delivery status.

## 6. Enable customer delivery

SNS sandbox accounts can only send to verified destinations. Before accepting customer numbers, request SMS production access for the selected region in the AWS console. Follow AWS and Philippine carrier rules for sender identity registration; only set `SmsSenderId` after that sender is approved and supported. Test delivery again after approval.

Create AWS billing alarms and keep the SNS SMS spend quota conservative. SMS is charged per message and pricing varies by destination/carrier. Promotional credits may offset charges only when their terms allow it.

## Troubleshooting and rollback

- **Hook returns unauthorized / invalid signature:** ensure Lambda's `SUPABASE_SMS_HOOK_SECRET` exactly matches the current Supabase Send SMS Hook secret, including `v1,whsec_`. If the hook secret was rotated, update Lambda too.
- **SNS publish fails in sandbox:** verify the destination phone in the same AWS region. For customer traffic, request production access.
- **SNS publish is denied:** confirm the Lambda is using the execution role created by this stack and that the stack's `sns:Publish` policy is present.
- **Hook succeeds but no SMS arrives:** check the AWS region, SNS delivery reports, sender identity requirements, and per-country carrier restrictions.
- **Rollback:** disable or remove the HTTP Send SMS hook in Supabase, then configure a supported built-in SMS provider if phone OTP must remain available. Delete the CloudFormation/SAM stack only after the hook no longer points to its Function URL.

The handler checks the Standard Webhooks signature and five-minute timestamp window before reading the OTP, requires an E.164 destination and six-digit code, and returns errors without exposing the OTP or phone number.