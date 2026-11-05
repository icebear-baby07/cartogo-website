import unittest
from unittest.mock import MagicMock, patch

import server


class BotIdentityTests(unittest.TestCase):
	def test_reads_instructions_from_configured_identity_record(self):
		collection = MagicMock()
		collection.find_one.return_value = {"instructions": "Follow the approved bot instructions."}

		with patch.object(server, "BOT_IDENTITY_COLLECTION", collection):
			instructions = server.get_bot_identity_instructions()

		self.assertEqual(instructions, "Follow the approved bot instructions.")
		collection.find_one.assert_called_once_with(
			{"record_id": "cartogo-bot-identity", "record_type": "bot_identity"},
			{"_id": 0},
		)

	def test_builds_instructions_from_existing_structured_identity_record(self):
		collection = MagicMock()
		collection.find_one.return_value = {
			"name": "CB",
			"role": "Virtual customer support assistant",
			"organization": "Cartogo",
			"purpose": "Help customers with Cartogo bookings.",
			"voice": {"traits": ["Warm", "Concise"], "language": "Use the user's language."},
			"capabilities": ["Answer car-rental questions."],
			"boundaries": ["Do not invent Cartogo policies."],
		}

		with patch.object(server, "BOT_IDENTITY_COLLECTION", collection):
			instructions = server.get_bot_identity_instructions()

		self.assertIn("You are CB, a Virtual customer support assistant for Cartogo.", instructions)
		self.assertIn("- Answer car-rental questions.", instructions)
		self.assertIn("- Do not invent Cartogo policies.", instructions)

	def test_fails_when_mongodb_identity_collection_is_not_configured(self):
		with patch.object(server, "BOT_IDENTITY_COLLECTION", None):
			with self.assertRaisesRegex(server.BotIdentityError, "Configure MONGODB_URI"):
				server.get_bot_identity_instructions()

	def test_fails_when_identity_record_is_missing(self):
		collection = MagicMock()
		collection.find_one.return_value = None

		with patch.object(server, "BOT_IDENTITY_COLLECTION", collection):
			with self.assertRaisesRegex(server.BotIdentityError, "record is missing"):
				server.get_bot_identity_instructions()

	def test_fails_when_instructions_are_missing_or_invalid(self):
		for instructions in (None, "", "  ", ["not", "text"]):
			with self.subTest(instructions=instructions):
				collection = MagicMock()
				collection.find_one.return_value = {"instructions": instructions}

				with patch.object(server, "BOT_IDENTITY_COLLECTION", collection):
					with self.assertRaisesRegex(server.BotIdentityError, "structured identity fields"):
						server.get_bot_identity_instructions()


if __name__ == "__main__":
	unittest.main()
