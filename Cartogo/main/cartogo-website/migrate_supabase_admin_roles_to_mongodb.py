import json
import os
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from pymongo.errors import PyMongoError

from migrate_supabase_to_mongodb import load_local_environment
from mongo_data import MongoDataStore


PAGE_SIZE = 1000


def fetch_supabase_rows(table, columns):
	base_url = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
	service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
	if not base_url or not service_key:
		raise RuntimeError("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for the one-time administrator migration.")
	rows = []
	offset = 0
	while True:
		query = urlencode({
			"select": columns,
			"offset": offset,
			"limit": PAGE_SIZE,
		})
		request = Request(
			f"{base_url}/rest/v1/{table}?{query}",
			headers={"apikey": service_key, "Authorization": f"Bearer {service_key}"},
		)
		try:
			with urlopen(request, timeout=15) as response:
				page = json.loads(response.read())
		except HTTPError as error:
			if error.code in (400, 404) and table == "cartogo_admin_account_titles":
				return None
			if error.code == 400 and table == "cartogo_admin_accounts" and "is_owner" in columns:
				return fetch_supabase_rows(table, "admin_email")
			raise RuntimeError(f"Supabase rejected the read for {table} (HTTP {error.code}).") from None
		except (URLError, TimeoutError):
			raise RuntimeError(f"Could not connect to Supabase while reading {table}.") from None
		except json.JSONDecodeError:
			raise RuntimeError(f"Supabase returned invalid JSON for {table}.") from None
		if not isinstance(page, list):
			raise RuntimeError(f"Supabase returned an unexpected response for {table}.")
		rows.extend(page)
		if len(page) < PAGE_SIZE:
			return rows
		offset += PAGE_SIZE


def main():
	load_local_environment()
	store = MongoDataStore.from_environment()
	try:
		accounts = fetch_supabase_rows("cartogo_admin_accounts", "admin_email,is_owner")
		if accounts is None:
			raise RuntimeError("Supabase did not return the administrator account table.")
		title_rows = fetch_supabase_rows("cartogo_admin_account_titles", "admin_email,title")
		titles_by_email = {}
		for row in title_rows or []:
			email = str(row.get("admin_email") or "").strip().lower()
			title = row.get("title")
			if email and title in {"Owner", "Moderator"}:
				titles_by_email.setdefault(email, set()).add(title)

		initial_owner = os.environ.get(
			"CARTOGO_INITIAL_OWNER_EMAIL", "remuelfernan07@gmail.com"
		).strip().lower()
		store.ensure_admin_role_definitions()
		migrated = 0
		for account in accounts:
			email = str(account.get("admin_email") or "").strip().lower()
			if not email or store.get_admin_role(email):
				continue
			titles = titles_by_email.get(email)
			if not titles:
				titles = {"Owner"} if account.get("is_owner") or email == initial_owner else {"Moderator"}
			store.ensure_admin_role(email, tuple(sorted(titles)))
			migrated += 1
		print(
			f"Administrator migration complete. Initialized {migrated} MongoDB role record(s) "
			f"for {len(accounts)} Supabase allowlisted account(s). Existing MongoDB role records were preserved."
		)
	finally:
		store.client.close()


if __name__ == "__main__":
	try:
		main()
	except (RuntimeError, OSError, ValueError) as error:
		raise SystemExit(str(error)) from None
	except PyMongoError as error:
		raise SystemExit(f"MongoDB administrator migration failed ({type(error).__name__}). Check database permissions and connection.") from None
