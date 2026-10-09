# carTOGO.mnl — Car Rental Website

A red-themed car rental website for carTOGO.mnl with a customer-facing fleet, reservation inquiry form, pricing table, FAQ, contact section, and browser-based admin panel.

## Fleet
- Honda City — Ignited Red Metallic
- Mitsubishi Mirage G4 — Red
- Mitsubishi Mirage G4 — Silver
- Toyota Fortuner

Vehicle photos are stored in `images/` and are already connected to the fleet cards. The rates in `js/data.js` are starter values; update them in the Admin panel to your actual carTOGO.mnl rates before publishing.

## Run locally
Open `index.html` directly, or run:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Admin
Open `admin.html`. The current demo password is `carTOGO2026`. Change it in Settings before sharing the site.

## Chatbot preparation
The public site now includes a lower-right chatbot launcher, a full-view expansion, and a Chat Monitor tab in the admin panel. Chat conversations are stored in Supabase in the `chat_sessions` table. The assistant response is a placeholder until the Qwen 3 8B Q4 runtime endpoint is selected and connected in `js/chatbot.js`.

Run [supabase-chat-schema.sql](supabase-chat-schema.sql) in the Supabase SQL editor before opening the chatbot. The site upserts sessions into the `chat_sessions` table and the admin monitor reads and deletes them remotely. The session shape is `{ id, username, startedAt, lastMessageAt, messages }`, where each message has `role`, `content`, and `createdAt`.

Run [supabase-inquiry-migration.sql](supabase-inquiry-migration.sql) once to add the optional secondary phone field to existing inquiry tables.

The included policies match the current browser-only admin password and allow the public `anon` key to read and delete sessions. Before production use, replace those policies with Supabase Auth and role-based access so chat transcripts are not publicly accessible.

## Important
This version still uses browser `localStorage` for fleet settings and inquiries. That means customer inquiries are NOT shared across devices. For a real public booking system, connect `js/data.js` to a shared backend such as Firebase/Supabase or your own API and use real authentication.
