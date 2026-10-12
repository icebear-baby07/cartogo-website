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

## Contact Recommendation

Select **Talk to an expert** in the chat footer to open a blank page; use the back arrow or browser Back to return to the chat with the conversation preserved. You can hide the prompt with its X button.
