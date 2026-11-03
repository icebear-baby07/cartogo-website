import os
import math
from datetime import datetime, timedelta, timezone

from pymongo import MongoClient, ReturnDocument
from pymongo.errors import DuplicateKeyError, PyMongoError


INQUIRY_LOCATION_FIELDS = (
	"location",
	"target_latitude",
	"target_longitude",
	"nearest_pickup_name",
	"nearest_pickup_distance_km",
	"targetLatitude",
	"targetLongitude",
	"nearestPickupName",
	"nearestPickupDistanceKm",
)

ADMIN_ROLE_PERMISSIONS = {
	"Owner": ("inquiries", "fleet", "site_assets", "site_content", "chat", "admin_accounts"),
	"Moderator": ("inquiries", "fleet", "site_assets", "site_content", "chat"),
}


class MongoDataStore:
	def __init__(self, client, database_name, units_collection, site_assets_collection,
			site_content_collection, inquiries_collection, sequences_collection,
			site_database_name=None, admin_roles_collection="admin_roles",
			chat_sessions_collection="chat_sessions", email_outbox_collection="email_outbox"):
		self.client = client
		self.database = client[database_name]
		self.site_database = client[site_database_name or database_name]
		self.units = self.site_database[units_collection]
		self.site_assets = self.site_database[site_assets_collection]
		self.site_content = self.site_database[site_content_collection]
		self.inquiries = self.database[inquiries_collection]
		self.sequences = self.site_database[sequences_collection]
		self.admin_roles = self.site_database[admin_roles_collection]
		self.chat_sessions = self.site_database[chat_sessions_collection]
		self.email_outbox = self.database[email_outbox_collection]

	@classmethod
	def from_environment(cls):
		uri = os.environ.get("MONGODB_URI", "").strip()
		if not uri:
			raise RuntimeError("MONGODB_URI is not configured on the website server.")
		try:
			client = MongoClient(uri, serverSelectionTimeoutMS=5000, timeoutMS=10000)
			client.admin.command("ping")
		except PyMongoError as error:
			raise RuntimeError(f"Could not connect to MongoDB ({type(error).__name__}). Check the website server configuration.") from None
		store = cls(
			client,
			os.environ.get("MONGODB_DATABASE", "cartogo").strip() or "cartogo",
			os.environ.get("MONGODB_UNITS_COLLECTION", "vehicles").strip() or "vehicles",
			os.environ.get("MONGODB_SITE_ASSETS_COLLECTION", "site_assets").strip() or "site_assets",
			os.environ.get("MONGODB_SITE_CONTENT_COLLECTION", "site_content").strip() or "site_content",
			os.environ.get("MONGODB_INQUIRIES_COLLECTION", "inquiries").strip() or "inquiries",
			os.environ.get("MONGODB_SEQUENCES_COLLECTION", "site_sequences").strip() or "site_sequences",
			os.environ.get("MONGODB_SITE_DATABASE", "Site").strip() or "Site",
			os.environ.get("MONGODB_ADMIN_ROLES_COLLECTION", "admin_roles").strip() or "admin_roles",
			os.environ.get("MONGODB_CHAT_SESSIONS_COLLECTION", "chat_sessions").strip() or "chat_sessions",
			os.environ.get("MONGODB_EMAIL_OUTBOX_COLLECTION", "email_outbox").strip() or "email_outbox",
		)
		store.inquiries.create_index(
			"client_request_id",
			unique=True,
			sparse=True,
			name="client_request_id_unique",
		)
		store.email_outbox.create_index(
			[("status", 1), ("next_attempt_at", 1), ("created_at", 1)],
			name="email_outbox_pending",
		)
		return store

	@staticmethod
	def _public_document(document):
		if document is None:
			return None
		document = dict(document)
		document.pop("_id", None)
		document.pop("client_request_id", None)
		return document

	def ensure_admin_role_definitions(self):
		for title, permissions in ADMIN_ROLE_PERMISSIONS.items():
			self.admin_roles.update_one(
				{"_id": f"title:{title}"},
				{"$set": {"title": title, "permissions": list(permissions)}},
				upsert=True,
			)

	def ensure_admin_role(self, email, default_titles=("Moderator",)):
		normalized_email = str(email or "").strip().lower()
		if not normalized_email:
			raise ValueError("Administrator email is required.")
		self.ensure_admin_role_definitions()
		self.admin_roles.update_one(
			{"_id": f"account:{normalized_email}"},
			{"$setOnInsert": {
				"email": normalized_email,
				"titles": list(default_titles),
			}},
			upsert=True,
		)
		return self.get_admin_role(normalized_email)

	def get_admin_role(self, email):
		normalized_email = str(email or "").strip().lower()
		document = self.admin_roles.find_one({"_id": f"account:{normalized_email}"})
		if document is None:
			return None
		return {
			"email": normalized_email,
			"titles": list(document.get("titles") or []),
		}

	def has_admin_permission(self, email, permission):
		role = self.get_admin_role(email)
		if role is None:
			return False
		for title in role["titles"]:
			definition = self.admin_roles.find_one({"_id": f"title:{title}"})
			if definition and permission in definition.get("permissions", []):
				return True
		return False

	def list_admin_roles(self, emails):
		self.ensure_admin_role_definitions()
		return [
			self.ensure_admin_role(email)
			for email in sorted({str(email).strip().lower() for email in emails if email})
		]

	def set_admin_titles(self, email, titles):
		normalized_email = str(email or "").strip().lower()
		if not normalized_email or not isinstance(titles, list):
			raise ValueError("Provide an administrator email and title list.")
		normalized_titles = sorted(set(titles))
		if not normalized_titles or any(title not in ADMIN_ROLE_PERMISSIONS for title in normalized_titles):
			raise ValueError("An administrator must have at least one valid title.")
		self.ensure_admin_role_definitions()
		if self.admin_roles.find_one({"_id": f"account:{normalized_email}"}) is None:
			raise ValueError("That administrator account was not found.")
		if "Owner" not in normalized_titles and self.admin_roles.count_documents({
			"_id": {"$regex": "^account:"},
			"titles": "Owner",
		}) <= 1:
			raise ValueError("At least one Owner account must remain.")
		self.admin_roles.update_one(
			{"_id": f"account:{normalized_email}"},
			{"$set": {"titles": normalized_titles}},
		)
		return self.get_admin_role(normalized_email)

	def validate_admin_removal(self, email):
		role = self.get_admin_role(email)
		if role and "Owner" in role["titles"] and len(self.list_admin_emails_with_title("Owner")) <= 1:
			raise ValueError("At least one Owner account must remain.")

	def remove_admin_role(self, email):
		normalized_email = str(email or "").strip().lower()
		self.validate_admin_removal(normalized_email)
		self.admin_roles.delete_one({"_id": f"account:{normalized_email}"})

	def list_admin_emails_with_title(self, title):
		return sorted(
			document["email"]
			for document in self.admin_roles.find(
				{"_id": {"$regex": "^account:"}, "titles": title},
				{"email": 1},
			)
			if document.get("email")
		)

	def list_chat_sessions(self):
		return [
			self._public_document(document)
			for document in self.chat_sessions.find({}).sort("last_message_at", -1)
		]

	def save_chat_session(self, session):
		session_id = session.get("id")
		if not isinstance(session_id, str) or not session_id or len(session_id) > 200:
			raise ValueError("Choose a valid chat session.")
		existing = self.chat_sessions.find_one({"_id": session_id})
		if existing and existing.get("user_id") and existing.get("user_id") != session.get("user_id"):
			raise PermissionError("This chat session is linked to a different account.")
		document = {
			"_id": session_id,
			"id": session_id,
			"username": session["username"],
			"user_id": session.get("user_id"),
			"started_at": session["started_at"],
			"last_message_at": session["last_message_at"],
			"messages": session["messages"],
		}
		self.chat_sessions.update_one(
			{"_id": session_id},
			{"$set": {key: value for key, value in document.items() if key != "_id"}},
			upsert=True,
		)
		return self._public_document(document)

	def delete_chat_session(self, session_id):
		result = self.chat_sessions.delete_one({"_id": session_id})
		if result.deleted_count == 0:
			raise RuntimeError("That chat session no longer exists. Refresh the list and try again.")
		return {"id": session_id}

	def list_units(self, include_inactive=False):
		query = {} if include_inactive else {"status": {"$ne": "Inactive"}}
		return [
			self._public_document(document)
			for document in self.units.find(query).sort("id", 1)
		]

	def list_site_assets(self):
		return [
			self._public_document(document)
			for document in self.site_assets.find({}).sort("id", 1)
		]

	def get_site_content(self):
		content = self.site_content.find_one({"_id": "public"})
		if content is None:
			raise RuntimeError("MongoDB site content is not initialized. Run migrate_supabase_to_mongodb.py first.")
		return self._public_document(content)

	def list_inquiries(self):
		return [
			self._public_document(document)
			for document in self.inquiries.find({}).sort("created_at", -1)
		]

	def add_inquiry(self, inquiry, client_request_id=None):
		if client_request_id:
			existing = self.get_inquiry_by_client_request_id(client_request_id)
			if existing is not None:
				return existing
		inquiry_id = self._next_id("inquiries", self.inquiries)
		timestamp = datetime.now(timezone.utc).isoformat()
		document = {
			**{
				key: value for key, value in inquiry.items()
				if key not in INQUIRY_LOCATION_FIELDS
			},
			"id": inquiry_id,
			"_id": inquiry_id,
			"created_at": timestamp,
			"verified_at": timestamp,
		}
		if client_request_id:
			document["client_request_id"] = client_request_id
		try:
			self.inquiries.insert_one(document)
		except DuplicateKeyError:
			if not client_request_id:
				raise
			existing = self.get_inquiry_by_client_request_id(client_request_id)
			if existing is None:
				raise
			return existing
		return self._public_document(document)

	def get_inquiry_by_client_request_id(self, client_request_id):
		document = self.inquiries.find_one({"client_request_id": client_request_id})
		return self._public_document(document) if document is not None else None

	def enqueue_inquiry_confirmation(self, inquiry):
		inquiry_id = inquiry["id"]
		timestamp = datetime.now(timezone.utc)
		self.email_outbox.update_one(
			{"_id": f"inquiry-confirmation:{inquiry_id}"},
			{"$setOnInsert": {
				"inquiry_id": inquiry_id,
				"inquiry": inquiry,
				"status": "queued",
				"attempts": 0,
				"created_at": timestamp,
				"next_attempt_at": timestamp,
			}},
			upsert=True,
		)

	def claim_inquiry_confirmation(self, now=None):
		now = now or datetime.now(timezone.utc)
		return self.email_outbox.find_one_and_update(
			{"$or": [
				{"status": "queued", "next_attempt_at": {"$lte": now}},
				{"status": "processing", "locked_at": {"$lte": now - timedelta(minutes=5)}},
			]},
			{
				"$set": {"status": "processing", "locked_at": now},
				"$inc": {"attempts": 1},
			},
			sort=[("created_at", 1)],
			return_document=ReturnDocument.AFTER,
		)

	def mark_inquiry_confirmation_sent(self, outbox_id):
		self.email_outbox.update_one(
			{"_id": outbox_id, "status": "processing"},
			{"$set": {
				"status": "sent",
				"sent_at": datetime.now(timezone.utc),
			}, "$unset": {"locked_at": "", "last_error": ""}},
		)

	def retry_inquiry_confirmation(self, outbox_id, attempts, error_type):
		now = datetime.now(timezone.utc)
		failed = attempts >= 5
		delay_seconds = min(60 * (2 ** max(0, attempts - 1)), 3600)
		updates = {
			"status": "failed" if failed else "queued",
			"last_error": error_type,
		}
		if not failed:
			updates["next_attempt_at"] = now + timedelta(seconds=delay_seconds)
		self.email_outbox.update_one(
			{"_id": outbox_id, "status": "processing"},
			{"$set": updates, "$unset": {"locked_at": ""}},
		)

	def remove_inquiry_location_data(self):
		result = self.inquiries.update_many(
			{},
			{"$unset": {field: "" for field in INQUIRY_LOCATION_FIELDS}},
		)
		return result.modified_count

	def update_inquiry_status(self, inquiry_id, status):
		updated = self.inquiries.find_one_and_update(
			{"_id": inquiry_id},
			{"$set": {"status": status}},
			return_document=ReturnDocument.AFTER,
		)
		if updated is None:
			raise RuntimeError("That inquiry no longer exists. Refresh the list and try again.")
		return self._public_document(updated)

	def restore_inquiry(self, inquiry_id):
		updated = self.inquiries.find_one_and_update(
			{"_id": inquiry_id, "status": "rejected"},
			{
				"$set": {"status": "pending_review"},
				"$unset": {
					"rejection_reason": "",
					"rejection_email_sent": "",
					"rejection_email_sent_at": "",
				},
			},
			return_document=ReturnDocument.AFTER,
		)
		if updated is None:
			if self.inquiries.find_one({"_id": inquiry_id}) is None:
				raise RuntimeError("That inquiry no longer exists. Refresh the list and try again.")
			raise ValueError("Only rejected inquiries can be restored.")
		return self._public_document(updated)

	def get_inquiry(self, inquiry_id):
		document = self.inquiries.find_one({"_id": inquiry_id})
		return self._public_document(document) if document else None

	def reject_inquiry(self, inquiry_id, reason):
		updated = self.inquiries.find_one_and_update(
			{"_id": inquiry_id, "status": {"$ne": "rejected"}},
			{"$set": {
				"status": "rejected",
				"rejection_reason": reason,
				"rejection_email_sent": False,
			}},
			return_document=ReturnDocument.AFTER,
		)
		if updated is None:
			if self.inquiries.find_one({"_id": inquiry_id}) is None:
				raise RuntimeError("That inquiry no longer exists. Refresh the list and try again.")
			raise RuntimeError("This inquiry has already been rejected.")
		return self._public_document(updated)

	def mark_inquiry_rejection_email_sent(self, inquiry_id):
		updated = self.inquiries.find_one_and_update(
			{"_id": inquiry_id, "status": "rejected"},
			{"$set": {
				"rejection_email_sent": True,
				"rejection_email_sent_at": datetime.now(timezone.utc).isoformat(),
			}},
			return_document=ReturnDocument.AFTER,
		)
		if updated is None:
			raise RuntimeError("The rejected inquiry no longer exists. Refresh the list and try again.")
		return self._public_document(updated)

	def delete_inquiry(self, inquiry_id):
		result = self.inquiries.delete_one({"_id": inquiry_id})
		if result.deleted_count == 0:
			raise RuntimeError("That inquiry no longer exists. Refresh the list and try again.")

	def update_site_content(self, updates):
		if not isinstance(updates, dict) or not updates:
			raise ValueError("Provide site settings or labels to update.")
		fields = {}
		settings = updates.get("settings")
		labels = updates.get("labels")
		if settings is not None:
			if not isinstance(settings, dict):
				raise ValueError("Settings must be a JSON object.")
			allowed_settings = {
				"companyName", "tagline", "currency", "depositPercent",
				"extraDriverFee", "childSeatFee", "lateFeePerHour",
			}
			if set(settings) - allowed_settings:
				raise ValueError("Settings contain unsupported fields.")
			for key, value in settings.items():
				if key in {"companyName", "tagline", "currency"}:
					if not isinstance(value, str) or not value.strip() or len(value) > 120:
						raise ValueError(f"{key} must be a non-empty text value up to 120 characters.")
				elif (isinstance(value, bool) or not isinstance(value, (int, float))
						or not math.isfinite(value) or value < 0):
					raise ValueError(f"{key} must be a non-negative number.")
			if "depositPercent" in settings and settings["depositPercent"] > 100:
				raise ValueError("depositPercent must not exceed 100.")
			fields.update({f"settings.{key}": value for key, value in settings.items()})
		if labels is not None:
			if not isinstance(labels, dict):
				raise ValueError("Labels must be a JSON object.")
			if "contact" in labels:
				raise ValueError("Contact and pickup details must be managed in the site assets collection.")
			fields["labels"] = labels
		if len(fields) == 0 or set(updates) - {"settings", "labels"}:
			raise ValueError("Only settings and labels can be updated here.")
		self.site_content.update_one({"_id": "public"}, {"$set": fields})
		return self.get_site_content()

	def _next_id(self, key, collection):
		maximum = collection.find_one(sort=[("id", -1)])
		maximum_id = maximum.get("id", 0) if maximum else 0
		self.sequences.update_one(
			{"_id": key},
			{"$max": {"value": maximum_id}},
			upsert=True,
		)
		sequence = self.sequences.find_one_and_update(
			{"_id": key},
			{"$inc": {"value": 1}},
			return_document=ReturnDocument.AFTER,
		)
		return sequence["value"]

	def apply_unit_change(self, action, unit):
		if action == "add":
			unit_id = self._next_id("vehicles", self.units)
			document = {**unit, "id": unit_id, "_id": unit_id}
			self.units.insert_one(document)
			return self._public_document(document)
		unit_id = unit["id"]
		if action == "delete":
			result = self.units.delete_one({"_id": unit_id})
			if result.deleted_count == 0:
				raise RuntimeError("That unit no longer exists. Refresh the inventory and try again.")
			return {"id": unit_id}
		updated = self.units.find_one_and_update(
			{"_id": unit_id},
			{"$set": {key: value for key, value in unit.items() if key not in {"id", "_id"}}},
			return_document=ReturnDocument.AFTER,
		)
		if updated is None:
			raise RuntimeError("That unit no longer exists. Refresh the inventory and try again.")
		return self._public_document(updated)

	def apply_site_asset_change(self, action, asset):
		if action == "add":
			asset_id = self._next_id("site_assets", self.site_assets)
			document = {**asset, "id": asset_id, "_id": asset_id}
			self._ensure_unique_site_asset(document)
			self.site_assets.insert_one(document)
			return self._public_document(document)
		asset_id = asset["id"]
		if action == "delete":
			result = self.site_assets.delete_one({"_id": asset_id, "asset_type": "location"})
			if result.deleted_count == 0:
				raise RuntimeError("That site location no longer exists. Refresh the list and try again.")
			return {"id": asset_id}
		document = {**asset, "_id": asset_id}
		self._ensure_unique_site_asset(document)
		updated = self.site_assets.find_one_and_update(
			{"_id": asset_id},
			{"$set": {key: value for key, value in asset.items() if key not in {"id", "_id"}}},
			return_document=ReturnDocument.AFTER,
		)
		if updated is None:
			raise RuntimeError("That site asset no longer exists. Refresh the list and try again.")
		return self._public_document(updated)

	def _ensure_unique_site_asset(self, asset):
		query = {"asset_type": asset["asset_type"]}
		if asset["asset_type"] == "location":
			query["loc_name"] = asset.get("loc_name")
		if asset.get("id") is not None:
			query["id"] = {"$ne": asset["id"]}
		if self.site_assets.find_one(query):
			if asset["asset_type"] == "location":
				raise ValueError("A pickup location with that name already exists.")
			raise ValueError("A live-agent contact record already exists.")
