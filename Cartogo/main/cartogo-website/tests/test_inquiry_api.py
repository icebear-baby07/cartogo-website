import hashlib
import time
import unittest

from unittest.mock import MagicMock, Mock, patch

from server import (
	GUEST_EMAIL_CHALLENGES,
	GUEST_EMAIL_REQUESTS,
	GUEST_EMAIL_VERIFICATIONS,
	WebsiteHandler,
)


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

	def test_google_inquiry_can_use_verified_email_without_phone(self):
		self.payload["phone"] = ""

		result = WebsiteHandler.normalize_public_inquiry(self.payload, self.user)

		self.assertIsNone(result["phone"])
		self.assertEqual(result["email"], "customer@example.com")

	def test_guest_inquiry_uses_submitted_identity_and_is_marked_unverified(self):
		result = WebsiteHandler.normalize_public_inquiry(self.payload, None)

		self.assertEqual(result["name"], "Untrusted Name")
		self.assertEqual(result["email"], "someone-else@example.com")
		self.assertIsNone(result["user_id"])
		self.assertEqual(result["verification_method"], "guest_form")

	def test_guest_inquiry_requires_phone_and_validates_email(self):
		self.payload["phone"] = ""
		with self.assertRaisesRegex(ValueError, "Phone number"):
			WebsiteHandler.normalize_public_inquiry(self.payload, None)

		self.payload["phone"] = "+63 912 345 6789"
		self.payload["email"] = ""
		with self.assertRaisesRegex(ValueError, "Email"):
			WebsiteHandler.normalize_public_inquiry(self.payload, None)

		self.payload["email"] = "not-an-email"
		with self.assertRaisesRegex(ValueError, "valid email"):
			WebsiteHandler.normalize_public_inquiry(self.payload, None)

	def test_guest_email_is_normalized_for_verification_token_matching(self):
		self.payload["email"] = " Customer@Example.COM "

		result = WebsiteHandler.normalize_public_inquiry(self.payload, None)

		self.assertEqual(result["email"], "customer@example.com")

	def test_guest_email_verification_token_is_single_use_and_email_bound(self):
		token = "test-verification-token"
		GUEST_EMAIL_VERIFICATIONS[token] = {
			"email": "someone-else@example.com",
			"expires_at": time.time() + 60,
		}

		self.assertFalse(WebsiteHandler.claim_guest_email_verification(token, "wrong@example.com"))
		self.assertTrue(WebsiteHandler.claim_guest_email_verification(token, "someone-else@example.com"))
		self.assertFalse(WebsiteHandler.claim_guest_email_verification(token, "someone-else@example.com"))
		WebsiteHandler.finish_guest_email_verification(token, consume=False)
		self.assertTrue(WebsiteHandler.claim_guest_email_verification(token, "someone-else@example.com"))
		WebsiteHandler.finish_guest_email_verification(token, consume=True)
		self.assertFalse(WebsiteHandler.claim_guest_email_verification(token, "someone-else@example.com"))

	def test_hourly_inquiry_is_a_single_rate_block_on_one_date(self):
		self.payload.update({
			"rentalMode": "hourly",
			"pickupTime": "09:30",
			"returnDate": self.payload["pickupDate"],
			"rentalPeriodHours": 12,
			"estimatedRentalHours": 12,
			"rentalDays": 1,
			"discountPercent": 0,
			"discountAmount": 0,
		})

		result = WebsiteHandler.normalize_public_inquiry(self.payload, self.user)

		self.assertEqual(result["rental_mode"], "hourly")
		self.assertEqual(result["rental_days"], 1)

	def test_rejects_mixed_hourly_and_custom_day_values(self):
		self.payload.update({
			"rentalMode": "hourly",
			"returnDate": self.payload["pickupDate"],
			"rentalPeriodHours": 12,
			"estimatedRentalHours": 96,
			"rentalDays": 4,
		})

		with self.assertRaisesRegex(ValueError, "single 12- or 24-hour block"):
			WebsiteHandler.normalize_public_inquiry(self.payload, self.user)

	def test_rejects_invalid_optional_phone_numbers(self):
		self.payload["phone"] = "123"

		with self.assertRaisesRegex(ValueError, "7 to 15 digits"):
			WebsiteHandler.normalize_public_inquiry(self.payload, self.user)

	def test_verified_google_identity_with_confirmed_email_is_accepted(self):
		handler = object.__new__(WebsiteHandler)
		handler.headers = {"Authorization": "Bearer token"}
		user = {
			"id": "user-123",
			"email": "customer@example.com",
			"app_metadata": {"providers": ["email", "google"]},
			"user_metadata": {"full_name": "Verified Customer"},
			"email_confirmed_at": "2026-10-22T00:00:00Z",
		}

		with unittest.mock.patch.dict("os.environ", {
			"SUPABASE_URL": "https://example.supabase.co",
			"SUPABASE_ANON_KEY": "anon",
		}), unittest.mock.patch.object(WebsiteHandler, "supabase_request", return_value=user):
			result = handler.get_verified_google_user()

		self.assertEqual(result, user)

	def test_accepts_numeric_string_inquiry_ids(self):
		self.assertEqual(WebsiteHandler.normalize_inquiry_id("12"), 12)


class GuestEmailVerificationTests(unittest.TestCase):
	def setUp(self):
		GUEST_EMAIL_CHALLENGES.clear()
		GUEST_EMAIL_VERIFICATIONS.clear()
		GUEST_EMAIL_REQUESTS.clear()
		self.handler = object.__new__(WebsiteHandler)
		self.handler.client_address = ("192.0.2.10", 12345)
		self.handler.read_json = Mock()
		self.handler.send_json = Mock()

	def add_challenge(self, code="123456", expires_at=None):
		challenge_id = "challenge-test"
		GUEST_EMAIL_CHALLENGES[challenge_id] = {
			"email": "customer@example.com",
			"code_hash": hashlib.sha256(f"{challenge_id}:{code}".encode()).hexdigest(),
			"expires_at": expires_at if expires_at is not None else time.time() + 600,
			"attempts": 0,
		}
		return challenge_id

	def test_request_sends_six_digit_code_and_stores_hashed_challenge(self):
		smtp = MagicMock()
		smtp_context = smtp.__enter__.return_value
		with patch.dict("os.environ", {"SMTP_USER": "mailer@example.com", "SMTP_APP_PASSWORD": "test-password"}), \
			patch("server.smtplib.SMTP", return_value=smtp), \
			patch("server.secrets.token_urlsafe", return_value="challenge-test"), \
			patch("server.secrets.randbelow", return_value=123456):
			self.handler.read_json.return_value = {"email": " Customer@Example.COM "}
			self.handler.request_guest_email_verification()

		self.handler.send_json.assert_called_once()
		status, result = self.handler.send_json.call_args.args
		self.assertEqual(status, 200)
		self.assertEqual(result, {"challengeId": "challenge-test", "expiresIn": 600})
		message = smtp_context.send_message.call_args.args[0]
		self.assertIn("123456", message.get_content())
		challenge = GUEST_EMAIL_CHALLENGES["challenge-test"]
		self.assertEqual(challenge["email"], "customer@example.com")
		self.assertNotIn("123456", challenge["code_hash"])

	def test_request_throttles_same_client_and_email(self):
		GUEST_EMAIL_REQUESTS["192.0.2.10:customer@example.com"] = time.time()
		self.handler.read_json.return_value = {"email": "customer@example.com"}
		with patch.dict("os.environ", {"SMTP_USER": "mailer@example.com", "SMTP_APP_PASSWORD": "test-password"}), \
			patch("server.smtplib.SMTP") as smtp:
			self.handler.request_guest_email_verification()

		self.handler.send_json.assert_called_once()
		self.assertEqual(self.handler.send_json.call_args.args[0], 400)
		smtp.assert_not_called()

	def test_request_reports_smtp_failure_and_removes_challenge(self):
		with patch.dict("os.environ", {"SMTP_USER": "mailer@example.com", "SMTP_APP_PASSWORD": "test-password"}), \
			patch("server.smtplib.SMTP", side_effect=OSError("offline")), \
			patch("server.secrets.token_urlsafe", return_value="challenge-test"):
			self.handler.read_json.return_value = {"email": "customer@example.com"}
			self.handler.request_guest_email_verification()

		self.handler.send_json.assert_called_once()
		self.assertEqual(self.handler.send_json.call_args.args[0], 503)
		self.assertNotIn("challenge-test", GUEST_EMAIL_CHALLENGES)

	def test_verify_rejects_bad_and_expired_codes(self):
		challenge_id = self.add_challenge()
		self.handler.read_json.return_value = {"challengeId": challenge_id, "code": "999999"}
		self.handler.verify_guest_email()
		self.assertEqual(self.handler.send_json.call_args.args[0], 400)
		self.assertEqual(GUEST_EMAIL_CHALLENGES[challenge_id]["attempts"], 1)

		self.handler.send_json.reset_mock()
		GUEST_EMAIL_CHALLENGES[challenge_id]["expires_at"] = time.time() - 1
		self.handler.verify_guest_email()
		self.assertEqual(self.handler.send_json.call_args.args[0], 400)
		self.assertNotIn(challenge_id, GUEST_EMAIL_CHALLENGES)

	def test_verify_expires_challenge_after_five_wrong_attempts(self):
		challenge_id = self.add_challenge()
		self.handler.read_json.return_value = {"challengeId": challenge_id, "code": "999999"}

		for _ in range(5):
			self.handler.verify_guest_email()

		self.assertNotIn(challenge_id, GUEST_EMAIL_CHALLENGES)
		self.handler.send_json.assert_called_with(400, {"error": "The verification code is incorrect or expired."})
		self.handler.send_json.reset_mock()
		self.handler.verify_guest_email()
		self.handler.send_json.assert_called_with(400, {"error": "That verification code expired. Request a new one."})

	def test_successful_verification_returns_email_bound_single_use_token(self):
		challenge_id = self.add_challenge()
		self.handler.read_json.return_value = {"challengeId": challenge_id, "code": "123456"}
		self.handler.verify_guest_email()

		status, result = self.handler.send_json.call_args.args
		self.assertEqual(status, 200)
		token = result["verificationToken"]
		self.assertEqual(GUEST_EMAIL_VERIFICATIONS[token]["email"], "customer@example.com")
		self.assertFalse(WebsiteHandler.claim_guest_email_verification(token, "another@example.com"))
		self.assertTrue(WebsiteHandler.claim_guest_email_verification(token, "customer@example.com"))
		self.assertFalse(WebsiteHandler.claim_guest_email_verification(token, "customer@example.com"))
		WebsiteHandler.finish_guest_email_verification(token, consume=True)
		self.assertNotIn(token, GUEST_EMAIL_VERIFICATIONS)


if __name__ == "__main__":
	unittest.main()
