import os
from pathlib import Path

from pymongo.errors import PyMongoError

from migrate_supabase_to_mongodb import fetch_all_supabase_rows, load_local_environment
from mongo_data import MongoDataStore


ROOT = Path(__file__).resolve().parent


def import_chat_sessions(collection, rows):
	imported = 0
	for row in rows:
		session_id = row.get("id")
		if not isinstance(session_id, str) or not session_id or len(session_id) > 200:
			raise RuntimeError("Found an invalid chat session ID in Supabase.")
		document = {
			"_id": session_id,
			"id": session_id,
			"username": row.get("username") or "Guest",
			"user_id": row.get("user_id"),
			"started_at": row.get("started_at"),
			"last_message_at": row.get("last_message_at"),
			"messages": row.get("messages") or [],
		}
		result = collection.update_one(
			{"_id": session_id},
			{"$setOnInsert": document},
			upsert=True,
		)
		imported += int(result.upserted_id is not None)
	return imported


def main():
	load_local_environment()
	store = MongoDataStore.from_environment()
	try:
		rows = fetch_all_supabase_rows("chat_sessions")
		store.chat_sessions.create_index("last_message_at")
		imported = import_chat_sessions(store.chat_sessions, rows)
		print(
			f"Chat migration complete. Imported {imported} of {len(rows)} session(s); "
			"existing MongoDB sessions were preserved and Supabase rows were not changed."
		)
	finally:
		store.client.close()


if __name__ == "__main__":
	try:
		main()
	except (RuntimeError, OSError, ValueError) as error:
		raise SystemExit(str(error)) from None
	except PyMongoError as error:
		raise SystemExit(f"MongoDB chat migration failed ({type(error).__name__}). Check database permissions and connection.") from None
