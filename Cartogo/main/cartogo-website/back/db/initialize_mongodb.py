import argparse
import json
import os
import sys
from pathlib import Path

from pymongo import ASCENDING, DESCENDING, MongoClient
from pymongo.errors import PyMongoError


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from mongo_data import MongoDataStore


WEBSITE_ENV_KEYS = {
	"MONGODB_URI",
	"MONGODB_DATABASE",
	"MONGODB_SITE_DATABASE",
	"MONGODB_UNITS_COLLECTION",
	"MONGODB_SITE_ASSETS_COLLECTION",
	"MONGODB_SITE_CONTENT_COLLECTION",
	"MONGODB_INQUIRIES_COLLECTION",
	"MONGODB_SEQUENCES_COLLECTION",
	"MONGODB_ADMIN_ROLES_COLLECTION",
	"MONGODB_CHAT_SESSIONS_COLLECTION",
	"MONGODB_EMAIL_OUTBOX_COLLECTION",
}

STARTER_SITE_ASSETS = (
	{
		"_id": 1,
		"id": 1,
		"asset_type": "location",
		"loc_name": "Pickup point A",
		"coordinates": {"lat": 14.7267518, "lng": 120.9392327},
		"display_name": "Quezon City - Fairview",
		"description": "Fairview pickup location",
		"opening_hours": "06:00:00",
		"closing_hours": "22:00:00",
		"status": "open",
	},
	{
		"_id": 2,
		"id": 2,
		"asset_type": "location",
		"loc_name": "Pickup point B",
		"coordinates": {"lat": 14.6271442, "lng": 121.0115951},
		"display_name": "Airport Area - Pasay",
		"description": "Airport-area pickup location",
		"opening_hours": "06:00:00",
		"closing_hours": "22:00:00",
		"status": "open",
	},
	{
		"_id": 3,
		"id": 3,
		"asset_type": "location",
		"loc_name": "Pickup point C",
		"coordinates": {"lat": 14.760287, "lng": 121.153861},
		"display_name": "Quezon City - Commonwealth Ave",
		"description": "Commonwealth Avenue pickup location",
		"opening_hours": "06:00:00",
		"closing_hours": "22:00:00",
		"status": "open",
	},
	{
		"_id": 4,
		"id": 4,
		"asset_type": "contact",
		"display_name": "Live agent",
		"description": "",
		"phone": "+63 2 8555 0142",
		"email": "hello@cartogo.mnl",
		"operational_hours": "Mon - Sun, 6:00 AM - 10:00 PM",
		"opening_hours": "06:00:00",
		"closing_hours": "22:00:00",
		"status": "open",
	},
)


def read_environment_file(path):
	values = {}
	if not path.exists():
		return values
	for raw_line in path.read_text(encoding="utf-8").splitlines():
		line = raw_line.strip()
		if not line or line.startswith("#") or "=" not in line:
			continue
		name, value = line.split("=", 1)
		name = name.strip()
		value = value.strip()
		if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
			value = value[1:-1]
		values[name] = value
	return values


def load_website_environment():
	for name, value in read_environment_file(ROOT / ".env").items():
		if name in WEBSITE_ENV_KEYS:
			os.environ.setdefault(name, value)


def ensure_website_indexes(store):
	store.units.create_index("id", unique=True)
	store.site_assets.create_index(
		"loc_name",
		unique=True,
		partialFilterExpression={"asset_type": "location"},
	)
	store.site_assets.create_index(
		"asset_type",
		unique=True,
		partialFilterExpression={"asset_type": "contact"},
	)
	store.inquiries.create_index("id", unique=True)
	store.inquiries.create_index([("created_at", DESCENDING)])
	store.inquiries.create_index(
		"client_request_id",
		unique=True,
		sparse=True,
		name="client_request_id_unique",
	)
	store.chat_sessions.create_index("last_message_at")
	store.email_outbox.create_index(
		[("status", ASCENDING), ("next_attempt_at", ASCENDING), ("created_at", ASCENDING)],
		name="email_outbox_pending",
	)


def seed_site_content(store):
	seed_path = ROOT / "back" / "data" / "site_content_seed.json"
	site_content = json.loads(seed_path.read_text(encoding="utf-8"))
	result = store.site_content.update_one(
		{"_id": "public"},
		{"$setOnInsert": {"_id": "public", **site_content}},
		upsert=True,
	)
	return result.upserted_id is not None


def seed_starter_site_assets(store):
	if store.site_assets.count_documents({}) != 0:
		return 0
	store.site_assets.insert_many(STARTER_SITE_ASSETS)
	return len(STARTER_SITE_ASSETS)


def sync_id_sequences(store):
	for key, collection in (
		("vehicles", store.units),
		("site_assets", store.site_assets),
		("inquiries", store.inquiries),
	):
		maximum = collection.find_one(sort=[("id", DESCENDING)], projection={"id": 1})
		if maximum is None:
			continue
		maximum_id = maximum.get("id")
		if isinstance(maximum_id, bool) or not isinstance(maximum_id, int) or maximum_id < 1:
			raise RuntimeError(f"Found an invalid numeric ID in the MongoDB {key} collection.")
		store.sequences.update_one(
			{"_id": key},
			{"$max": {"value": maximum_id}},
			upsert=True,
		)


def ensure_chatbot_log_indexes(website_client):
	chatbot_env = read_environment_file(ROOT.parent.parent / "chatbot" / ".env")
	uri = chatbot_env.get("MONGODB_URI", "").strip() or os.environ.get("CHATBOT_MONGODB_URI", "").strip()
	if not uri:
		return False

	database_name = chatbot_env.get("MONGODB_DATABASE", "cartogo").strip() or "cartogo"
	collection_name = chatbot_env.get("MONGODB_COLLECTION", "chat_logs").strip() or "chat_logs"
	if uri == os.environ.get("MONGODB_URI"):
		client = website_client
		close_client = False
	else:
		client = MongoClient(uri, serverSelectionTimeoutMS=5000)
		close_client = True
	try:
		if close_client:
			client.admin.command("ping")
		logs = client[database_name][collection_name]
		logs.create_index(
			[("user_id", ASCENDING), ("created_at", DESCENDING)],
			name="user_id_created_at",
		)
		logs.create_index(
			[("session_id", ASCENDING), ("created_at", ASCENDING)],
			name="session_id_created_at",
		)
	finally:
		if close_client:
			client.close()
	return True


def initialize(args):
	load_website_environment()
	store = MongoDataStore.from_environment()
	try:
		ensure_website_indexes(store)
		content_created = seed_site_content(store)
		store.ensure_admin_role_definitions()
		asset_count = seed_starter_site_assets(store) if args.seed_starter_assets else 0
		sync_id_sequences(store)
		chatbot_indexes_created = ensure_chatbot_log_indexes(store.client)
		print("Website MongoDB indexes and administrator title definitions are ready.")
		print(f"Public site content: {'seeded' if content_created else 'existing content preserved'}.")
		if args.seed_starter_assets:
			print(f"Starter pickup/contact records added: {asset_count}.")
		else:
			print("Starter pickup/contact records were not requested.")
		print(
			"Chatbot request-log indexes: "
			+ ("ready." if chatbot_indexes_created else "skipped; chatbot MONGODB_URI is not configured.")
		)
	finally:
		store.client.close()


def main():
	parser = argparse.ArgumentParser(description="Initialize the carTOGO MongoDB collections and indexes.")
	parser.add_argument(
		"--seed-starter-assets",
		action="store_true",
		help="Add the legacy starter pickup/contact records only when site_assets is empty.",
	)
	args = parser.parse_args()
	try:
		initialize(args)
	except (OSError, RuntimeError, ValueError, json.JSONDecodeError) as error:
		raise SystemExit(str(error)) from None
	except PyMongoError as error:
		raise SystemExit(
			f"MongoDB initialization failed ({type(error).__name__}). "
			"Check the connection, collection permissions, and existing indexes."
		) from None


if __name__ == "__main__":
	main()
