# Getting Started

Follow these prerequisite steps before attempting to access the application through your browser.

---

## Prerequisites & Setup

### Start Everything

From the workspace root, double-click **`start_cartogo.cmd`**. It opens separate terminals for AWS sign-in, the main website, and the chatbot. Complete AWS sign-in in its terminal when prompted.

The website launcher validates `main/cartogo-website/.env` and starts the website server. The chatbot launcher prepares its isolated Python environment and starts the chatbot server.

### Start Services Individually

1. AWS sign-in: **`start_aws_login.cmd`**
2. Main website: **`start_site.cmd`**
3. Chatbot: **`chatbot/start_chat.cmd`**

Keep the website and chatbot terminals open while using the app. The AWS sign-in terminal may be closed after authentication completes. Rerunning a service launcher detects an existing server instead of starting a duplicate.

For chatbot-only development, use **`chatbot/restart_chat.cmd`** to restart the bot without restarting the website or AWS login. It only stops a listener that it can verify is running this chatbot's `server.py`.

## Contact Recommendation

Select **Talk to an expert** in the chat footer to see the agent-queue preview, then open the agent-chat preview. Use the **Assistant** and **Agent** controls to switch views. The agent flow is a local UI preview only; it is not connected to a staffed queue, and its messages are not saved or delivered. You can hide the expert prompt with its X button.
