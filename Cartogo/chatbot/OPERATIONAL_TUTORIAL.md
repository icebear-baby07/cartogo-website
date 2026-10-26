# Getting Started

Follow these prerequisite steps before attempting to access the application through your browser.

---

## Prerequisites & Setup

### Start Everything

From the workspace root, double-click **`start_cartogo.cmd`**. It opens separate terminals for AWS sign-in, the main website, and the chatbot. Complete AWS sign-in in its terminal when prompted.

The website launcher validates `main/cartogo-website/.env` and starts the website server. The chatbot launcher prepares its isolated Python environment and starts the chatbot server.

The chatbot terminal highlights HTTP response status codes: successful responses in green, redirects in cyan, client errors in yellow, and server errors in red with contrasting text. Set `NO_COLOR` to disable status colors.

### Start Services Individually

1. AWS sign-in: **`start_aws_login.cmd`**
2. Main website: **`start_site.cmd`**
3. Chatbot: **`chatbot/start_chat.cmd`**

Keep the website and chatbot terminals open while using the app. The AWS sign-in terminal may be closed after authentication completes. Rerunning a service launcher detects an existing server instead of starting a duplicate.

For bot and frontend development, use **`chatbot/restart_chat.cmd`** to restart the chatbot and the website at `/front/` without restarting AWS login. Each service only stops a listener it can verify belongs to that project's `server.py`.

## Company Knowledge

The chatbot can look up company reference records in MongoDB and use matching content when answering. Chat logs remain in the database configured by `MONGODB_DATABASE` and `MONGODB_COLLECTION`; proprietary information uses the `kb` database and the `PROPRIETARY_INFO_COLLECTION` collection by default. Configure its database and collection with `MONGODB_KNOWLEDGE_DATABASE` and `MONGODB_KNOWLEDGE_COLLECTION` in `chatbot/.env`.

Vehicle questions read the public catalog from the same MongoDB database and collection configured for the website (`MONGODB_DATABASE=cartogo`, `MONGODB_UNITS_COLLECTION=vehicles`). Use the same server-side `MONGODB_URI` in `chatbot/.env`; the chatbot no longer needs Supabase credentials for inventory. It excludes units with `Inactive` status, lists matching vehicle facts and rates directly from the catalog, and says it cannot verify a vehicle answer if the catalog has no matching records. For recommendations, it lists available vehicles and asks for passenger count, destination, budget, or preferred features before narrowing the choices.

Try `What vehicles are available? Include each vehicle's capacity and rates.` to list the available fleet, or ask about one exact model, such as `What are the rates for the Toyota Fortuner?`. Company-specific policy answers require matching, approved records in the configured knowledge collection; the chatbot does not infer policies from the vehicle catalog or website page copy.

Add documents to the knowledge collection with a text `content` field. The keyword lookup searches `title`, `content`, `topic`, `keywords`, and `tags`. For example:

```json
{
	"title": "Reservation changes",
	"topic": "reservations",
	"keywords": ["change", "modify", "reservation"],
	"content": "Company-approved information about changing a reservation goes here.",
	"updated_at": "2026-10-15"
}
```

The bot provides up to four matching records to Amazon Bedrock as reference context. If a Cartogo-specific question has no matching content, it will say it cannot verify the answer. This first version uses keyword matching, which is best suited to a relatively small knowledge collection. Only store information approved for processing by the configured Bedrock model, and ensure the MongoDB user can read the knowledge database as well as perform the existing chat-log operations.

The assistant profile is loaded separately from `kb.bot_identity` (configurable with `MONGODB_IDENTITY_COLLECTION`) using the stable `record_id` `cartogo-bot-identity` and `record_type` `bot_identity`. Proprietary company facts remain in `kb.PROPRIETARY_INFO_COLLECTION`. The profile is included as context on each request. Safety boundaries remain in the local `assets/data/bot_data/identity.json` fallback and are not loaded from MongoDB; profile data cannot override them. If the MongoDB profile is absent, the local identity file also supplies the profile fallback. Changes to the MongoDB profile take effect on the next chat request.

## Contact Recommendation

Select **Talk to an expert** in the chat footer to see the agent-queue preview, then open the agent-chat preview. Use the **Assistant** and **Agent** controls to switch views. The agent flow is a local UI preview only; it is not connected to a staffed queue, and its messages are not saved or delivered. You can hide the expert prompt with its X button.
