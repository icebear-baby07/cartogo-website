import unittest
from unittest.mock import ANY, MagicMock, patch
from datetime import datetime, timezone

from mongo_data import MongoDataStore


class MongoDataStoreTests(unittest.TestCase):
	@patch.dict("os.environ", {"MONGODB_URI": "mongodb://example"}, clear=True)
	@patch("mongo_data.MongoClient")
	def test_environment_defaults_site_collections_to_site_database(self, mongo_client):
		store = MongoDataStore.from_environment()

		mongo_client.return_value.__getitem__.assert_any_call("Site")
		mongo_client.return_value.__getitem__.assert_any_call("cartogo")
		self.assertIs(store.site_database, mongo_client.return_value["Site"])
		self.assertIs(store.database, mongo_client.return_value["cartogo"])

	def setUp(self):
		self.collections = {}
		self.databases = {}

		def database_for(name):
			database = self.databases.setdefault(name, MagicMock())
			database.__getitem__.side_effect = lambda collection: self.collections.setdefault(
				(name, collection), MagicMock()
			)
			return database

		self.client = MagicMock()
		self.client.__getitem__.side_effect = database_for
		self.store = MongoDataStore(
			self.client,
			"cartogo",
			"vehicles",
			"site_assets",
			"site_content",
			"inquiries",
			"site_sequences",
			"Site",
		)
		self.database = self.databases["cartogo"]
		self.site_database = self.databases["Site"]
		self.units = self.store.units
		self.assets = self.store.site_assets
		self.content = self.store.site_content
		self.inquiries = self.store.inquiries
		self.sequences = self.store.sequences
		self.admin_roles = self.store.admin_roles
		self.chat_sessions = self.store.chat_sessions
		self.email_outbox = self.store.email_outbox

	def test_site_collections_and_sequences_use_site_database(self):
		self.assertIs(self.store.units, self.site_database["vehicles"])
		self.assertIs(self.store.site_assets, self.site_database["site_assets"])
		self.assertIs(self.store.site_content, self.site_database["site_content"])
		self.assertIs(self.store.sequences, self.site_database["site_sequences"])
		self.assertIs(self.store.inquiries, self.database["inquiries"])
		self.assertIs(self.store.email_outbox, self.database["email_outbox"])

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

	def test_admin_roles_are_stored_in_site_database(self):
		self.assertIs(self.store.admin_roles, self.site_database["admin_roles"])

	def test_ensuring_new_admin_role_uses_set_on_insert(self):
		self.admin_roles.find_one.return_value = {
			"_id": "account:moderator@example.com",
			"email": "moderator@example.com",
			"titles": ["Moderator"],
		}

		role = self.store.ensure_admin_role("Moderator@Example.com")

		self.assertEqual(role, {"email": "moderator@example.com", "titles": ["Moderator"]})
		self.assertEqual(
			self.admin_roles.update_one.call_args_list[-1].args,
			(
				{"_id": "account:moderator@example.com"},
				{"$setOnInsert": {
					"email": "moderator@example.com",
					"titles": ["Moderator"],
				}},
			),
		)

	def test_chat_session_save_preserves_the_public_session_shape(self):
		self.chat_sessions.find_one.return_value = None
		session = {
			"id": "session-1",
			"username": "Guest",
			"user_id": None,
			"started_at": "2026-11-03T10:00:00Z",
			"last_message_at": "2026-11-03T10:01:00Z",
			"messages": [{"role": "user", "content": "Hello"}],
		}

		result = self.store.save_chat_session(session)

		self.assertEqual(result, session)
		self.chat_sessions.update_one.assert_called_once_with(
			{"_id": "session-1"},
			{"$set": session},
			upsert=True,
		)

	def test_chat_session_cannot_be_rebound_to_another_account(self):
		self.chat_sessions.find_one.return_value = {"user_id": "original-user"}
		session = {
			"id": "session-1",
			"username": "Guest",
			"user_id": "different-user",
			"started_at": "2026-11-03T10:00:00Z",
			"last_message_at": "2026-11-03T10:01:00Z",
			"messages": [],
		}

		with self.assertRaisesRegex(PermissionError, "different account"):
			self.store.save_chat_session(session)

		self.chat_sessions.update_one.assert_not_called()

	def test_chat_session_delete_reports_missing_record(self):
		self.chat_sessions.delete_one.return_value.deleted_count = 0

		with self.assertRaisesRegex(RuntimeError, "no longer exists"):
			self.store.delete_chat_session("session-1")

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

	def test_adding_inquiry_keeps_notes_and_omits_location_details(self):
		self.sequences.find_one_and_update.return_value = {"value": 8}
		inquiry = {
			"name": "Test customer",
			"notes": "Please include a child seat.",
			"location": "Fairview",
			"target_latitude": 14.75,
			"target_longitude": 121.05,
			"nearest_pickup_name": "Pickup point A",
			"nearest_pickup_distance_km": 2.5,
		}

		result = self.store.add_inquiry(inquiry)
		document = self.inquiries.insert_one.call_args.args[0]

		self.assertEqual(result["notes"], "Please include a child seat.")
		self.assertEqual(document["notes"], "Please include a child seat.")
		self.assertFalse({
			"location",
			"target_latitude",
			"target_longitude",
			"nearest_pickup_name",
			"nearest_pickup_distance_km",
		} & document.keys())

	def test_adding_inquiry_is_idempotent_for_a_client_request_id(self):
		request_id = "9a73516c-c37c-4123-a70f-ec747450cc83"
		self.inquiries.find_one.return_value = {
			"_id": 13,
			"id": 13,
			"client_request_id": request_id,
			"name": "Existing customer",
		}

		result = self.store.add_inquiry({"name": "Changed payload"}, request_id)

		self.assertEqual(result, {"id": 13, "name": "Existing customer"})
		self.sequences.find_one_and_update.assert_not_called()
		self.inquiries.insert_one.assert_not_called()

	def test_email_confirmation_is_queued_once_per_inquiry(self):
		inquiry = {"id": 13, "email": "customer@example.com"}

		self.store.enqueue_inquiry_confirmation(inquiry)

		query, update = self.email_outbox.update_one.call_args.args
		self.assertEqual(query, {"_id": "inquiry-confirmation:13"})
		self.assertEqual(update["$setOnInsert"]["inquiry"], inquiry)
		self.assertEqual(update["$setOnInsert"]["status"], "queued")
		self.assertEqual(self.email_outbox.update_one.call_args.kwargs, {"upsert": True})

	def test_claiming_email_confirmation_increments_attempts(self):
		now = datetime.now(timezone.utc)

		self.store.claim_inquiry_confirmation(now)

		query, update = self.email_outbox.find_one_and_update.call_args.args
		self.assertEqual(query["$or"][0], {
			"status": "queued",
			"next_attempt_at": {"$lte": now},
		})
		self.assertEqual(query["$or"][1]["status"], "processing")
		self.assertEqual(update["$inc"], {"attempts": 1})
		self.assertEqual(update["$set"], {"status": "processing", "locked_at": now})
		self.assertEqual(self.email_outbox.find_one_and_update.call_args.kwargs["return_document"], ANY)

	def test_failed_email_job_is_scheduled_or_marked_failed(self):
		self.store.retry_inquiry_confirmation("job-1", 2, "SMTPException")

		updates = self.email_outbox.update_one.call_args.args[1]
		self.assertEqual(updates["$set"]["status"], "queued")
		self.assertEqual(updates["$set"]["last_error"], "SMTPException")
		self.assertIn("next_attempt_at", updates["$set"])
		self.assertEqual(updates["$unset"], {"locked_at": ""})

		self.store.retry_inquiry_confirmation("job-1", 5, "SMTPException")
		updates = self.email_outbox.update_one.call_args.args[1]
		self.assertEqual(updates["$set"]["status"], "failed")
		self.assertNotIn("next_attempt_at", updates["$set"])

	def test_location_cleanup_unsets_only_requested_inquiry_fields(self):
		self.inquiries.update_many.return_value.modified_count = 3

		removed_documents = self.store.remove_inquiry_location_data()

		self.assertEqual(removed_documents, 3)
		self.inquiries.update_many.assert_called_once_with(
			{},
			{"$unset": {
				"location": "",
				"target_latitude": "",
				"target_longitude": "",
				"nearest_pickup_name": "",
				"nearest_pickup_distance_km": "",
				"targetLatitude": "",
				"targetLongitude": "",
				"nearestPickupName": "",
				"nearestPickupDistanceKm": "",
			}},
		)

	def test_inquiry_status_update_reports_missing_records(self):
		self.inquiries.find_one_and_update.return_value = None

		with self.assertRaisesRegex(RuntimeError, "no longer exists"):
			self.store.update_inquiry_status(42, "confirmed")

		self.inquiries.find_one_and_update.assert_called_once()

	def test_restoring_rejected_inquiry_clears_rejection_metadata(self):
		restored = {"_id": 42, "id": 42, "status": "pending_review"}
		self.inquiries.find_one_and_update.return_value = restored

		result = self.store.restore_inquiry(42)

		self.inquiries.find_one_and_update.assert_called_once_with(
			{"_id": 42, "status": "rejected"},
			{
				"$set": {"status": "pending_review"},
				"$unset": {
					"rejection_reason": "",
					"rejection_email_sent": "",
					"rejection_email_sent_at": "",
				},
			},
			return_document=ANY,
		)
		self.assertEqual(result, {"id": 42, "status": "pending_review"})

	def test_restoring_non_rejected_inquiry_is_rejected(self):
		self.inquiries.find_one_and_update.return_value = None
		self.inquiries.find_one.return_value = {"_id": 42, "status": "confirmed"}

		with self.assertRaisesRegex(ValueError, "Only rejected inquiries"):
			self.store.restore_inquiry(42)

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
