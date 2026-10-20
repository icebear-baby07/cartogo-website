import unittest

from server import WebsiteHandler


class InquiryNormalizationTests(unittest.TestCase):
	def setUp(self):
		self.user = {
			"id": "user-123",
			"email": "customer@example.com",
			"user_metadata": {"full_name": "Verified Customer", "email_verified": True},
		}
		self.payload = {
			"name": "Untrusted Name",
			"email": "someone-else@example.com",
			"phone": "+63 912 345 6789",
			"carId": "4",
			"carName": "Honda City",
			"capacity": 5,
			"pickupDate": "2026-10-21",
			"pickupTime": "09:30",
			"returnDate": "2026-10-25",
			"location": "Fairview",
			"targetLatitude": 14.75,
			"targetLongitude": 121.05,
			"nearestPickupName": "Fairview",
			"nearestPickupDistanceKm": 2.5,
			"rateRegion": "in",
			"rentalPeriodHours": 24,
			"estimatedRentalHours": 96,
			"ratePerPeriod": 2000,
			"rentalDays": 4,
			"discountPercent": 5,
			"discountAmount": 400,
			"quotedRate": 7600,
			"notes": "Test request",
			"status": "rejected",
			"userId": "different-user",
			"verificationMethod": "phone_otp",
		}

	def test_inquiry_identity_and_verification_are_taken_from_authenticated_user(self):
		result = WebsiteHandler.normalize_public_inquiry(self.payload, self.user)

		self.assertEqual(result["name"], "Verified Customer")
		self.assertEqual(result["email"], "customer@example.com")
		self.assertEqual(result["user_id"], "user-123")
		self.assertEqual(result["status"], "confirmed")
		self.assertEqual(result["verification_method"], "google_oauth")
		self.assertEqual(result["car_id"], "4")

	def test_rejects_invalid_coordinates(self):
		self.payload["targetLatitude"] = 91

		with self.assertRaisesRegex(ValueError, "accepted range"):
			WebsiteHandler.normalize_public_inquiry(self.payload, self.user)

	def test_rejects_return_date_before_pickup_date(self):
		self.payload["returnDate"] = "2026-10-20"

		with self.assertRaisesRegex(ValueError, "earlier"):
			WebsiteHandler.normalize_public_inquiry(self.payload, self.user)

	def test_accepts_numeric_string_inquiry_ids(self):
		self.assertEqual(WebsiteHandler.normalize_inquiry_id("12"), 12)


if __name__ == "__main__":
	unittest.main()
