import unittest
from unittest.mock import MagicMock, patch

import server


class InventoryResponseTests(unittest.TestCase):
	def setUp(self):
		self.records = [
			{
				"id": 1,
				"display_name": "TOYOTA Fortuner",
				"capacity": 7,
				"in12_rate": 2800,
				"in24_rate": 3300,
				"out12_rate": 3300,
				"out24_rate": 3800,
				"luzon_rate": 4000,
				"status": "Available",
				"features": ["SUV"],
			},
			{
				"id": 2,
				"display_name": "Mitsubishi Mirage G4",
				"capacity": 4,
				"in12_rate": 1100,
				"in24_rate": 1400,
				"out12_rate": 1400,
				"out24_rate": 1700,
				"luzon_rate": 2000,
				"status": "Available",
				"features": [],
			},
			{
				"id": 3,
				"display_name": "Toyota Avanza",
				"capacity": 6,
				"in12_rate": 1400,
				"in24_rate": 1800,
				"out12_rate": 1800,
				"out24_rate": 2200,
				"luzon_rate": 2500,
				"status": "Available",
				"features": [],
			},
			{
				"id": 4,
				"display_name": "Inactive Unit",
				"capacity": 5,
				"status": "Inactive",
			},
		]

	def lookup(self, query):
		cursor = MagicMock()
		cursor.sort.return_value.limit.return_value = [
			record for record in self.records if record.get("status") != "Inactive"
		]
		catalog = MagicMock()
		catalog.find.return_value = cursor
		with patch.object(server, "VEHICLE_CATALOG", catalog):
			return server.find_unit_records(query)

	def test_lists_all_available_vehicles_for_broad_inventory_question(self):
		results = self.lookup("What vehicles are available? Include each vehicle's capacity and rates.")

		self.assertEqual(
			[record["display_name"] for record in results],
			["TOYOTA Fortuner", "Mitsubishi Mirage G4", "Toyota Avanza"],
		)

	def test_exact_vehicle_lookup_still_matches_by_name(self):
		results = self.lookup("What are the rates for Fortuner?")

		self.assertEqual([record["display_name"] for record in results], ["TOYOTA Fortuner"])

	def test_vehicle_name_followup_finds_catalog_record_without_relying_on_chat_history(self):
		results = self.lookup("What about Avanza?")
		reply = server.format_unit_reply(results, "What about Avanza?")

		self.assertEqual([record["display_name"] for record in results], ["Toyota Avanza"])
		self.assertIn("PHP 1,400.00", reply)

	def test_recommendation_question_returns_grounded_inventory_and_requests_preferences(self):
		results = self.lookup("What vehicles will you recommend?")
		reply = server.format_unit_reply(results, "What vehicles will you recommend?")

		self.assertIn("passenger count, destination, budget", reply)
		self.assertIn("TOYOTA Fortuner", reply)
		self.assertIn("Mitsubishi Mirage G4", reply)
		self.assertNotIn("Inactive Unit", reply)

	def test_formatted_rates_are_separate_markdown_lines(self):
		reply = server.format_unit_reply(self.records[:1], "What are the rates for Fortuner?")

		self.assertIn("### TOYOTA Fortuner\n- Capacity: 7 passengers", reply)
		self.assertIn("- Metro Manila, 12 hours: PHP 2,800.00", reply)
		self.assertIn("- Luzon, per day: PHP 4,000.00", reply)


if __name__ == "__main__":
	unittest.main()
