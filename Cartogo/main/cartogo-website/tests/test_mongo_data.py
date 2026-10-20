import unittest
from unittest.mock import MagicMock

from mongo_data import MongoDataStore


class MongoDataStoreTests(unittest.TestCase):
	def setUp(self):
		self.collections = {}
		self.database = MagicMock()
		self.database.__getitem__.side_effect = lambda name: self.collections.setdefault(name, MagicMock())
		self.client = MagicMock()
		self.client.__getitem__.return_value = self.database
		self.store = MongoDataStore(
			self.client,
			"cartogo",
			"vehicles",
			"site_assets",
			"site_content",
			"inquiries",
			"site_sequences",
		)
		self.units = self.store.units
		self.assets = self.store.site_assets
		self.content = self.store.site_content
		self.inquiries = self.store.inquiries
		self.sequences = self.store.sequences

	def test_public_unit_listing_excludes_inactive_and_hides_mongo_id(self):
		self.units.find.return_value.sort.return_value = [
			{"_id": 1, "id": 1, "status": "Available"}
		]

		result = self.store.list_units()

		self.units.find.assert_called_once_with({"status": {"$ne": "Inactive"}})
		self.assertEqual(result, [{"id": 1, "status": "Available"}])

	def test_site_content_update_only_changes_the_requested_public_fields(self):
		self.content.find_one.return_value = {
			"_id": "public",
			"settings": {"companyName": "CarTOGO"},
			"labels": {"hero": {"title": "Updated"}},
			"discountRules": [],
			"socialLinks": [],
		}

		result = self.store.update_site_content({"settings": {"companyName": "CarTOGO"}})

		self.content.update_one.assert_called_once_with(
			{"_id": "public"},
			{"$set": {"settings.companyName": "CarTOGO"}},
		)
		self.assertNotIn("_id", result)
		self.assertEqual(result["settings"]["companyName"], "CarTOGO")

	def test_site_content_rejects_unknown_settings(self):
		with self.assertRaisesRegex(ValueError, "unsupported fields"):
			self.store.update_site_content({"settings": {"mongodbUri": "secret"}})
		self.content.update_one.assert_not_called()

	def test_site_content_rejects_duplicate_contact_data(self):
		with self.assertRaisesRegex(ValueError, "site assets"):
			self.store.update_site_content({"labels": {"contact": {"phone": "123"}}})
		self.content.update_one.assert_not_called()

	def test_inquiry_listing_sorts_newest_first_and_hides_mongo_id(self):
		self.inquiries.find.return_value.sort.return_value = [
			{"_id": 3, "id": 3, "created_at": "2026-01-02T00:00:00+00:00"}
		]

		result = self.store.list_inquiries()

		self.inquiries.find.assert_called_once_with({})
		self.inquiries.find.return_value.sort.assert_called_once_with("created_at", -1)
		self.assertEqual(result, [{"id": 3, "created_at": "2026-01-02T00:00:00+00:00"}])

	def test_adding_inquiry_uses_monotonic_id_and_sets_verification_timestamps(self):
		self.inquiries.find_one.return_value = {"id": 7}
		self.sequences.find_one_and_update.return_value = {"value": 8}
		self.inquiries.insert_one.return_value = None
		inquiry = {"name": "Test customer", "status": "confirmed"}

		result = self.store.add_inquiry(inquiry)

		document = self.inquiries.insert_one.call_args.args[0]
		self.assertEqual(document["id"], 8)
		self.assertEqual(document["_id"], 8)
		self.assertEqual(document["name"], "Test customer")
		self.assertEqual(document["status"], "confirmed")
		self.assertEqual(document["created_at"], document["verified_at"])
		self.assertNotIn("_id", result)

	def test_inquiry_status_update_reports_missing_records(self):
		self.inquiries.find_one_and_update.return_value = None

		with self.assertRaisesRegex(RuntimeError, "no longer exists"):
			self.store.update_inquiry_status(42, "confirmed")

		self.inquiries.find_one_and_update.assert_called_once()

	def test_unit_add_uses_a_monotonic_id_and_keeps_source_id_field(self):
		self.units.find_one.return_value = {"id": 12}
		self.sequences.find_one_and_update.return_value = {"value": 13}
		self.units.insert_one.return_value = None
		unit = {"brand": "Honda", "model": "City", "status": "Available"}

		result = self.store.apply_unit_change("add", unit)

		self.units.insert_one.assert_called_once_with({
			**unit,
			"id": 13,
			"_id": 13,
		})
		self.assertEqual(result["id"], 13)
		self.assertNotIn("_id", result)

	def test_site_asset_update_rejects_duplicate_location_name(self):
		self.assets.find_one.return_value = {"id": 5}
		asset = {
			"id": 2,
			"asset_type": "location",
			"loc_name": "Pickup point A",
			"display_name": "Fairview",
		}

		with self.assertRaisesRegex(ValueError, "already exists"):
			self.store.apply_site_asset_change("update", asset)
		self.assets.find_one_and_update.assert_not_called()


if __name__ == "__main__":
	unittest.main()
