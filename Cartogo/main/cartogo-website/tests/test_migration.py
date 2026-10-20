import unittest
from unittest.mock import MagicMock, call, patch

import migrate_supabase_to_mongodb


class MigrationTests(unittest.TestCase):
	@patch("migrate_supabase_to_mongodb.fetch_supabase_table")
	def test_fetches_all_pages_in_order(self, fetch_page):
		fetch_page.side_effect = [[{"id": 1}, {"id": 2}], [{"id": 3}]]

		with patch.object(migrate_supabase_to_mongodb, "PAGE_SIZE", 2):
			rows = migrate_supabase_to_mongodb.fetch_all_supabase_rows("inquiries")

		self.assertEqual(rows, [{"id": 1}, {"id": 2}, {"id": 3}])
		self.assertEqual(fetch_page.call_args_list, [call("inquiries", 0), call("inquiries", 2)])

	def test_import_rows_preserves_source_ids_and_only_counts_insertions(self):
		collection = MagicMock()
		collection.name = "inquiries"
		collection.update_one.side_effect = [
			MagicMock(upserted_id=10),
			MagicMock(upserted_id=None),
		]

		imported = migrate_supabase_to_mongodb.import_rows(
			collection,
			[{"id": 10, "name": "New"}, {"id": 11, "name": "Existing"}],
		)

		self.assertEqual(imported, 1)
		self.assertEqual(collection.update_one.call_args_list[0].args, (
			{"_id": 10},
			{"$setOnInsert": {"id": 10, "name": "New", "_id": 10}},
		))


if __name__ == "__main__":
	unittest.main()
