import json
import os
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from pymongo.errors import PyMongoError

from mongo_data import MongoDataStore


ROOT = Path(__file__).resolve().parent
ENVIRONMENT_KEYS = {
	"SUPABASE_URL",
	"SUPABASE_SERVICE_ROLE_KEY",
	"MONGODB_URI",
	"MONGODB_DATABASE",
	"MONGODB_UNITS_COLLECTION",
	"MONGODB_SITE_ASSETS_COLLECTION",
	"MONGODB_SITE_CONTENT_COLLECTION",
	"MONGODB_SEQUENCES_COLLECTION",
}


def load_local_environment():
	path = ROOT / ".env"
	if not path.exists():
		return
	for line in path.read_text(encoding="utf-8").splitlines():
		line = line.strip()
		if not line or line.startswith("#") or "=" not in line:
			continue
		name, value = line.split("=", 1)
		name = name.strip()
		if name not in ENVIRONMENT_KEYS or name in os.environ:
			continue
		value = value.strip()
		if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
			value = value[1:-1]
		os.environ[name] = value


def fetch_supabase_table(table):
	base_url = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
	service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
	if not base_url or not service_key:
		raise RuntimeError("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for this one-time migration so inactive inventory rows are included.")
	request = Request(
		f"{base_url}/rest/v1/{table}?select=*&order=id.asc",
		headers={"apikey": service_key, "Authorization": f"Bearer {service_key}"},
	)
	try:
		with urlopen(request, timeout=15) as response:
			result = json.loads(response.read())
	except HTTPError as error:
		raise RuntimeError(f"Supabase rejected the read for {table} (HTTP {error.code}).") from None
	except (URLError, TimeoutError):
		raise RuntimeError(f"Could not connect to Supabase while reading {table}.") from None
	except json.JSONDecodeError:
		raise RuntimeError(f"Supabase returned invalid JSON for {table}.") from None
	if not isinstance(result, list):
		raise RuntimeError(f"Supabase returned an unexpected response for {table}.")
	return result


def import_rows(collection, rows):
	imported = 0
	for row in rows:
		document_id = row.get("id")
		if isinstance(document_id, bool) or not isinstance(document_id, int) or document_id < 1:
			raise RuntimeError(f"Found an invalid source ID in {collection.name}.")
		document = {**row, "_id": document_id}
		result = collection.update_one(
			{"_id": document_id},
			{"$setOnInsert": document},
			upsert=True,
		)
		imported += int(result.upserted_id is not None)
	return imported


def main():
	load_local_environment()
	store = MongoDataStore.from_environment()
	try:
		units = fetch_supabase_table("unit_data")
		site_assets = fetch_supabase_table("site_assets")
		seed_path = ROOT / "back" / "data" / "site_content_seed.json"
		site_content = json.loads(seed_path.read_text(encoding="utf-8"))

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

		imported_units = import_rows(store.units, units)
		imported_assets = import_rows(store.site_assets, site_assets)
		content_result = store.site_content.update_one(
			{"_id": "public"},
			{"$setOnInsert": {"_id": "public", **site_content}},
			upsert=True,
		)
		for key, collection in (("vehicles", store.units), ("site_assets", store.site_assets)):
			maximum = collection.find_one(sort=[("id", -1)])
			if maximum:
				store.sequences.update_one(
					{"_id": key},
					{"$max": {"value": maximum["id"]}},
					upsert=True,
				)
		print(
			"Migration complete. "
			f"Imported {imported_units} vehicle(s), {imported_assets} site asset(s), "
			f"and {'1 site-content document' if content_result.upserted_id else 'kept existing site content'}. "
			"Supabase source records were not modified or deleted."
		)
	finally:
		store.client.close()


if __name__ == "__main__":
	try:
		main()
	except (RuntimeError, OSError, ValueError) as error:
		raise SystemExit(str(error)) from None
	except PyMongoError as error:
		raise SystemExit(f"MongoDB migration failed ({type(error).__name__}). Check the MongoDB permissions and connection.") from None
