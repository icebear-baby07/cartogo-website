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
			"site_sequences",
		)
		self.units = self.store.units
		self.assets = self.store.site_assets
		self.content = self.store.site_content
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
