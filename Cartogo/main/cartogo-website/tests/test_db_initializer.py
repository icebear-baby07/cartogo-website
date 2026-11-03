import unittest
from unittest.mock import MagicMock

from back.db import initialize_mongodb


class MongoInitializerTests(unittest.TestCase):
	def test_website_indexes_match_current_collection_usage(self):
		store = MagicMock()

		initialize_mongodb.ensure_website_indexes(store)

		store.units.create_index.assert_called_once_with("id", unique=True)
		store.site_assets.create_index.assert_any_call(
			"loc_name",
			unique=True,
			partialFilterExpression={"asset_type": "location"},
		)
		store.site_assets.create_index.assert_any_call(
			"asset_type",
			unique=True,
			partialFilterExpression={"asset_type": "contact"},
		)
		store.inquiries.create_index.assert_any_call("id", unique=True)
		store.inquiries.create_index.assert_any_call([("created_at", -1)])
		store.inquiries.create_index.assert_any_call(
			"client_request_id",
			unique=True,
			sparse=True,
			name="client_request_id_unique",
		)
		store.chat_sessions.create_index.assert_called_once_with("last_message_at")
		store.email_outbox.create_index.assert_called_once_with(
			[("status", 1), ("next_attempt_at", 1), ("created_at", 1)],
			name="email_outbox_pending",
		)

	def test_starter_assets_are_inserted_only_into_an_empty_collection(self):
		store = MagicMock()
		store.site_assets.count_documents.return_value = 0

		inserted = initialize_mongodb.seed_starter_site_assets(store)

		self.assertEqual(inserted, 4)
		self.assertEqual(len(store.site_assets.insert_many.call_args.args[0]), 4)

		store.site_assets.count_documents.return_value = 4
		self.assertEqual(initialize_mongodb.seed_starter_site_assets(store), 0)
		store.site_assets.insert_many.assert_called_once()

	def test_sequences_are_synchronized_to_existing_records(self):
		store = MagicMock()
		store.units.find_one.return_value = {"id": 8}
		store.site_assets.find_one.return_value = {"id": 3}
		store.inquiries.find_one.return_value = None

		initialize_mongodb.sync_id_sequences(store)

		self.assertEqual(store.sequences.update_one.call_args_list[0].args, (
			{"_id": "vehicles"},
			{"$max": {"value": 8}},
		))
		self.assertEqual(store.sequences.update_one.call_args_list[1].args, (
			{"_id": "site_assets"},
			{"$max": {"value": 3}},
		))
		self.assertEqual(store.sequences.update_one.call_count, 2)


if __name__ == "__main__":
	unittest.main()
