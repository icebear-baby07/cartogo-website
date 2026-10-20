import os
import math

from pymongo import MongoClient, ReturnDocument
from pymongo.errors import PyMongoError


class MongoDataStore:
	def __init__(self, client, database_name, units_collection, site_assets_collection,
			site_content_collection, sequences_collection):
		self.client = client
		self.database = client[database_name]
		self.units = self.database[units_collection]
		self.site_assets = self.database[site_assets_collection]
		self.site_content = self.database[site_content_collection]
		self.sequences = self.database[sequences_collection]

	@classmethod
	def from_environment(cls):
		uri = os.environ.get("MONGODB_URI", "").strip()
		if not uri:
			raise RuntimeError("MONGODB_URI is not configured on the website server.")
		try:
			client = MongoClient(uri, serverSelectionTimeoutMS=5000)
			client.admin.command("ping")
		except PyMongoError as error:
			raise RuntimeError(f"Could not connect to MongoDB ({type(error).__name__}). Check the website server configuration.") from None
		return cls(
			client,
			os.environ.get("MONGODB_DATABASE", "cartogo").strip() or "cartogo",
			os.environ.get("MONGODB_UNITS_COLLECTION", "vehicles").strip() or "vehicles",
			os.environ.get("MONGODB_SITE_ASSETS_COLLECTION", "site_assets").strip() or "site_assets",
			os.environ.get("MONGODB_SITE_CONTENT_COLLECTION", "site_content").strip() or "site_content",
			os.environ.get("MONGODB_SEQUENCES_COLLECTION", "site_sequences").strip() or "site_sequences",
		)

	@staticmethod
	def _public_document(document):
		if document is None:
			return None
		document = dict(document)
		document.pop("_id", None)
		return document

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
