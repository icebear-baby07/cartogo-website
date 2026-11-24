# Version II chatbot operations

This guide covers the separate Python chatbot in
`Version_II_Implementation/apps/chatbot`. It does not describe the legacy
application or replace the website/API setup in [`../../RUNNING.md`](../../RUNNING.md).

## How the chatbot fits in

The website sends chat requests to the Version II API at
`/api/chatbot/chat`. The API forwards them to `http://127.0.0.1:8003` by
default; set `CHATBOT_URL` in `apps/api/.env` only when the chatbot is running
at a different URL. The chatbot uses Amazon Bedrock for language-model
responses and uses Supabase for its vehicle, company-reference, identity, and
chat-log data.

The standalone page at <http://127.0.0.1:8003/> is for local diagnostics and
direct access. It is not a health check for the database, AWS credentials, or
Bedrock. Chat requests use the service's `/api/chat` endpoint.

## Start it on Windows

1. Install Python 3.10 or later.
2. Configure `apps/chatbot/.env` as described below.
3. Open PowerShell in `Version_II_Implementation` and run:

   ```powershell
   npm.cmd run dev:chatbot
   ```

   Alternatively, run `apps\chatbot\start_chat.cmd`.

The launcher creates or repairs the `ctg-venv` environment in the Version II
directory, installs `apps/chatbot/requirements.txt`, and starts the server on
port `8003`. It may install packages on its first run or when requirements
change. Keep the terminal open while using the chatbot. Press **Ctrl+C** there
to stop it.

The chatbot is optional for starting the website and API, but live chat needs
it. If it is stopped, API chat requests return an unavailable-service error.
The website's contact/agent view is a preview and is not connected to a
staffed support queue.

The server binds to all network interfaces. Use it only on a trusted local
network, allow the port through a private-network firewall only when needed,
and do not expose this unauthenticated development service to the public
internet.

## Configure Supabase

Use `apps/chatbot/.env.example` as the template:

```env
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-server-only-secret
```

Keep each environment assignment on its own line. Never put the service-role
key in the website environment, source control, or chat.

The following resources must already be provisioned:

- `chatbot_reference_documents` and `chatbot_chat_log_documents` tables, each
  with `id` and JSON `document` columns used by the chatbot.
- The `get_cartogo_chatbot_identity` and `list_cartogo_chatbot_fleet` RPC
  functions.

The repository does not include a Supabase chatbot schema/bootstrap script.
Have the project owner provide the approved schema and confirm that the
service-role key is for the intended project.

## Configure identity and company knowledge

The chatbot requires a valid identity record before it can answer. The
identity returned by `get_cartogo_chatbot_identity` must include:

```json
{
  "record_id": "cartogo-bot-identity",
  "record_type": "bot_identity"
}
```

It may include a non-empty `instructions` string, or the structured
`name`, `role`, `organization`, `purpose`, `voice`, `capabilities`, and
`boundaries` fields. `voice` must include a `traits` array and may include a
`language` string.

Company-approved reference documents belong in
`chatbot_reference_documents`. Documents should contain useful text in
`content`; lookup also searches `title`, `topic`, `keywords`, and `tags`. The
chatbot uses keyword matching and provides up to four relevant records as
Bedrock context. Keep this table limited to approved, up-to-date company
information.

The chatbot does not invent company policies when its records do not support
an answer. Only store information approved for processing by the configured
Bedrock model.

## Fleet answers

Vehicle questions use the `list_cartogo_chatbot_fleet` RPC. Records marked
`Inactive` are excluded; availability and recommendation questions are
filtered to vehicles marked `Available`. Ensure fleet records include the
status, model, capacity, and rate fields needed for useful answers.

Try a direct inventory question such as:

> What vehicles are available? Include each vehicle's capacity and rates.

For a focused lookup, ask:

> What are the rates for the Toyota Fortuner?

## Configure Amazon Bedrock

The chatbot uses Boto3's standard AWS credential provider chain. Configure an
approved AWS profile or SSO session for the account running the server, and
grant it permission to invoke the selected Bedrock model. The default model is
`global.amazon.nova-2-lite-v1:0`. Set `BEDROCK_MODEL_ID` to use another
authorized model. Set `AWS_REGION` or `AWS_DEFAULT_REGION` to select a region;
the code falls back to the AWS profile's region and then
`ap-southeast-1`.

The AWS CLI is not required by the Python code itself, but it can be used to
configure or refresh the local AWS profile/SSO session. Keep credentials out
of `.env` and source files. Bedrock requests may incur AWS charges.

## Troubleshooting

- **API says the chatbot is unavailable:** confirm the chatbot terminal is
  running and that `CHATBOT_URL` in `apps/api/.env` matches its address.
- **Startup fails:** check the project URL, server-only key, and required
  tables/RPC functions.
- **Identity error:** verify that the configured identity record exists and
  matches the required schema.
- **AWS credentials or Bedrock error:** refresh the approved AWS profile/SSO
  session, then check model access and region.
Chat logs can contain the customer's question, bot response, session/user IDs,
and client IP address. Handle the database and logs as sensitive operational
data; do not use real customer data for unapproved testing.
