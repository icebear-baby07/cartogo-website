import hashlib
import io
import json
import time
import unittest

from unittest.mock import MagicMock, Mock, patch

from server import (
	GUEST_EMAIL_CHALLENGES,
	GUEST_EMAIL_REQUESTS,
	GUEST_EMAIL_VERIFICATIONS,
	UNIT_APPROVALS,
	WebsiteHandler,
	assess_target_location,
	build_branded_email,
	lookup_target_location,
	search_target_locations,
	send_branded_email,
	send_inquiry_confirmation,
	send_inquiry_rejection,
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
			"firstName": "Alex",
			"lastName": "Customer",
			"middleName": "",
			"suffix": "",
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

	def test_guest_name_requires_first_and_last_but_middle_and_suffix_are_optional(self):
		result = WebsiteHandler.normalize_public_inquiry(self.payload, None)
		self.assertEqual(result["name"], "Customer, Alex")

		self.payload["middleName"] = "Morgan"
		self.payload["suffix"] = "Jr."
		result = WebsiteHandler.normalize_public_inquiry(self.payload, None)
		self.assertEqual(result["name"], "Customer, Alex Morgan, Jr.")

		self.payload["firstName"] = ""
		with self.assertRaisesRegex(ValueError, "First name"):
			WebsiteHandler.normalize_public_inquiry(self.payload, None)

	def test_rejects_invalid_coordinates(self):
		self.payload["targetLatitude"] = 91

		with self.assertRaisesRegex(ValueError, "accepted range"):
			WebsiteHandler.normalize_public_inquiry(self.payload, self.user)


	def test_rejects_return_date_before_pickup_date(self):
		self.payload["returnDate"] = "2026-10-20"

		with self.assertRaisesRegex(ValueError, "earlier"):
			WebsiteHandler.normalize_public_inquiry(self.payload, self.user)

	def test_google_inquiry_requires_phone_number(self):
		self.payload["phone"] = ""

		with self.assertRaisesRegex(ValueError, "phone number with 7 to 15 digits"):
			WebsiteHandler.normalize_public_inquiry(self.payload, self.user)

		self.payload["phone"] = "+63 912 345 6789"
		result = WebsiteHandler.normalize_public_inquiry(self.payload, self.user)
		self.assertEqual(result["email"], "customer@example.com")
		self.assertEqual(result["phone"], "+63 912 345 6789")

	def test_rejects_zero_capacity(self):
		self.payload["capacity"] = 0

		with self.assertRaisesRegex(ValueError, "Capacity is outside the accepted range"):
			WebsiteHandler.normalize_public_inquiry(self.payload, self.user)

	def test_guest_inquiry_uses_submitted_identity_and_is_marked_unverified(self):
		result = WebsiteHandler.normalize_public_inquiry(self.payload, None)

		self.assertEqual(result["name"], "Customer, Alex")
		self.assertEqual(result["email"], "someone-else@example.com")
		self.assertIsNone(result["user_id"])
		self.assertEqual(result["verification_method"], "guest_form")

	def test_guest_inquiry_requires_phone_and_validates_email(self):
		self.payload["phone"] = ""
		with self.assertRaisesRegex(ValueError, "phone number"):
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


class TargetLocationValidationTests(unittest.TestCase):
	def test_request_log_leaves_status_codes_plain_for_powershell_coloring(self):
		handler = object.__new__(WebsiteHandler)
		handler.client_address = ("192.0.2.10", 12345)
		handler.log_date_time_string = Mock(return_value="26/Oct/2026 14:00:00")
		terminal = io.StringIO()
		terminal.isatty = Mock(return_value=True)

		with patch("server.sys.stdout", terminal):
			handler.log_message('"%s" %s -', "GET /config.js HTTP/1.1", 200)
			handler.log_message('"%s" %s -', "POST /api/target-location/validate HTTP/1.1", 503)

		output = terminal.getvalue()
		self.assertIn('"GET /config.js HTTP/1.1" 200 -', output)
		self.assertIn('"POST /api/target-location/validate HTTP/1.1" 503 -', output)
		self.assertNotIn("\x1b[", output)

	def test_error_response_logs_http_class_and_safe_technical_detail(self):
		handler = object.__new__(WebsiteHandler)
		handler.send_response = Mock()
		handler.send_header = Mock()
		handler.end_headers = Mock()
		handler.wfile = io.BytesIO()
		handler.log_message = Mock()

		handler.send_json(503, {"error": "Upstream service failed.\nRetry later."})

		handler.log_message.assert_called_once_with(
			"API diagnostic: HTTP %s %s; detail: %s",
			503,
			"Service Unavailable",
			"Upstream service failed. Retry later.",
		)

	def test_json_response_handles_client_disconnect_without_server_traceback(self):
		handler = object.__new__(WebsiteHandler)
		handler.send_response = Mock()
		handler.send_header = Mock()
		handler.end_headers = Mock()
		handler.wfile = Mock()
		handler.wfile.write.side_effect = ConnectionAbortedError("client disconnected")
		handler.close_connection = False

		handler.send_json(200, {"valid": True})

		self.assertTrue(handler.close_connection)
		handler.send_response.assert_called_once_with(200)

	def test_validation_endpoint_passes_through_the_snap_preference(self):
		handler = object.__new__(WebsiteHandler)
		handler.read_json = Mock(return_value={
			"latitude": 14.7,
			"longitude": 121.0,
			"snapInvalid": True,
		})
		handler.send_json = Mock()
		result = {"valid": True, "snapped": True}

		with patch("server.lookup_target_location", return_value=result) as lookup:
			handler.validate_target_location()

		lookup.assert_called_once_with(14.7, 121.0, True)
		handler.send_json.assert_called_once_with(200, result)

	def test_invalid_target_snaps_to_verified_residential_road_within_75_metres(self):
		def response(payload):
			mock_response = MagicMock()
			mock_response.__enter__.return_value = mock_response
			mock_response.read.return_value = json.dumps(payload).encode()
			return mock_response

		with patch("server.urlopen", side_effect=[
			response({
				"display_name": "Unmapped park",
				"category": "leisure",
				"type": "park",
				"address": {"city": "Quezon City"},
			}),
			response({
				"code": "Ok",
				"waypoints": [{"location": [121.0001, 14.7001], "distance": 15.2}],
			}),
			response({
				"display_name": "Residential Road, Quezon City",
				"category": "highway",
				"type": "residential",
				"address": {"road": "Residential Road", "neighbourhood": "Example Neighborhood", "city": "Quezon City"},
			}),
		]) as open_url, patch("server.TARGET_LOCATION_CACHE", {}), \
			patch("server.TARGET_LOCATION_LAST_REQUEST_AT", 0), \
			patch("server.time.time", return_value=100), patch("server.time.sleep"):
			result = lookup_target_location(14.7, 121.0, snap_invalid=True)

		self.assertTrue(result["valid"])
		self.assertTrue(result["snapped"])
		self.assertEqual(result["latitude"], 14.7001)
		self.assertEqual(result["longitude"], 121.0001)
		self.assertEqual(result["snapDistanceMeters"], 15.2)
		self.assertIn("nearest/v1/driving/121.000000,14.700000", open_url.call_args_list[1].args[0].full_url)
		self.assertIn("radiuses=75", open_url.call_args_list[1].args[0].full_url)

	def test_invalid_target_is_not_snapped_beyond_75_metres(self):
		def response(payload):
			mock_response = MagicMock()
			mock_response.__enter__.return_value = mock_response
			mock_response.read.return_value = json.dumps(payload).encode()
			return mock_response

		with patch("server.urlopen", side_effect=[
			response({
				"display_name": "Unmapped park",
				"category": "leisure",
				"type": "park",
				"address": {"city": "Quezon City"},
			}),
			response({
				"code": "Ok",
				"waypoints": [{"location": [121.001, 14.701], "distance": 75.1}],
			}),
		]), patch("server.TARGET_LOCATION_CACHE", {}), \
			patch("server.TARGET_LOCATION_LAST_REQUEST_AT", 0), \
			patch("server.time.time", return_value=100), patch("server.time.sleep"):
			result = lookup_target_location(14.7, 121.0, snap_invalid=True)

		self.assertFalse(result["valid"])
		self.assertIn("within 75 m", result["reason"])

	def test_search_returns_valid_philippines_results_and_caches_queries(self):
		handler_response = MagicMock()
		handler_response.__enter__.return_value = handler_response
		handler_response.read.return_value = (
			b'[{"display_name":"Quezon City, Philippines","lat":"14.6760","lon":"121.0437"},'
			b'{"display_name":"Invalid coordinates","lat":"91","lon":"181"}]'
		)
		with patch("server.urlopen", return_value=handler_response) as open_url, \
			patch("server.TARGET_LOCATION_SEARCH_CACHE", {}), \
			patch("server.TARGET_LOCATION_LAST_REQUEST_AT", 0), \
			patch("server.time.time", return_value=100), \
			patch("server.time.sleep"):
			results = search_target_locations("  Quezon   City ")
			cached_results = search_target_locations("quezon city")

		self.assertEqual(results, [{
			"label": "Quezon City, Philippines",
			"latitude": 14.676,
			"longitude": 121.0437,
		}])
		self.assertEqual(cached_results, results)
		open_url.assert_called_once()
		request = open_url.call_args.args[0]
		self.assertIn("countrycodes=ph", request.full_url)
		self.assertIn("limit=5", request.full_url)
		self.assertTrue(request.get_header("User-agent"))

	def test_search_rejects_too_short_queries(self):
		with self.assertRaisesRegex(ValueError, "between 3 and 200"):
			search_target_locations("ab")

	def test_accepts_a_mapped_road_in_a_populated_area(self):
		result = assess_target_location({
			"display_name": "Road, Neighborhood, Quezon City",
			"category": "highway",
			"type": "residential",
			"address": {"road": "Example Road", "neighbourhood": "Example Neighborhood", "city": "Quezon City"},
		})

		self.assertTrue(result["valid"])
		self.assertEqual(result["label"], "Road, Neighborhood, Quezon City")

	def test_rejects_unmapped_ocean_and_mountain_locations(self):
		cases = (
			{"error": "Unable to geocode"},
			{"category": "natural", "type": "ocean", "address": {"sea": "Pacific Ocean"}},
			{"category": "natural", "type": "peak", "address": {"mountain": "Remote Peak"}},
			{"category": "highway", "type": "track", "address": {"road": "Remote Track"}},
			{"category": "highway", "type": "primary", "address": {"road": "Main Road", "city": "Quezon City"}},
		)

		for location in cases:
			with self.subTest(location=location):
				result = assess_target_location(location)
				self.assertFalse(result["valid"])
				self.assertIn("reason", result)

	def test_unverified_reverse_lookup_keeps_place_name_for_the_hover_preview(self):
		result = assess_target_location({
			"display_name": "Unmapped ridge, Example District",
			"address": {"county": "Example District"},
		})

		self.assertFalse(result["valid"])
		self.assertEqual(result["label"], "Unmapped ridge, Example District")

	def test_rejects_non_residential_sites(self):
		result = assess_target_location({
			"category": "amenity",
			"type": "school",
			"address": {"road": "School Road", "suburb": "Example Suburb", "city": "Quezon City"},
		})

		self.assertFalse(result["valid"])


class InquiryLocationEnforcementTests(unittest.TestCase):
	def test_unverified_destination_is_rejected_before_saving(self):
		handler = object.__new__(WebsiteHandler)
		handler.headers = {}
		handler.read_json = Mock(return_value={})
		handler.send_json = Mock()
		inquiry = {"target_latitude": 14.75, "target_longitude": 121.05}
		store = Mock()
		with patch.object(WebsiteHandler, "normalize_public_inquiry", return_value=inquiry), \
			patch("server.lookup_target_location", return_value={
				"valid": False,
				"reason": "Choose a verified residential location.",
			}), patch("server.get_mongo_store", return_value=store):
			handler.create_inquiry()

		handler.send_json.assert_called_once_with(400, {"error": "Choose a verified residential location."})
		store.add_inquiry.assert_not_called()


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
		self.assertIn("123456", message.get_body(preferencelist=("plain",)).get_content())
		self.assertIn("carTOGO", message.get_body(preferencelist=("html",)).get_content())
		self.assertEqual(message["Subject"], "carTOGO.mnl | Verify your email")
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


class BrandedEmailTests(unittest.TestCase):
	def setUp(self):
		self.inquiry = {
			"name": "Alex <Customer>",
			"email": "customer@example.com",
			"phone": "+63 912 345 6789",
			"car_name": "Honda <City>",
			"rental_mode": "custom_days",
			"rental_period_hours": 24,
			"rental_days": 4,
			"pickup_date": "2026-10-21",
			"pickup_time": "09:30",
			"return_date": "2026-10-25",
			"location": "Fairview & Quezon City",
			"quoted_rate": 7600,
		}

	def test_branded_email_has_text_and_responsive_html_alternative(self):
		message = build_branded_email(
			"Example\r\nInjected header",
			"Preview text",
			"Email heading",
			"Intro text",
			"<strong>Details</strong>",
			"Plain text details",
		)

		self.assertEqual(message["Subject"], "Example  Injected header")
		self.assertIn("Plain text details", message.get_body(preferencelist=("plain",)).get_content())
		html_content = message.get_body(preferencelist=("html",)).get_content()
		self.assertIn("carTOGO", html_content)
		self.assertIn("Email heading", html_content)
		self.assertIn("max-width:600px", html_content)
		self.assertIn("<strong>Details</strong>", html_content)

	@patch("server.smtplib.SMTP")
	@patch.dict("os.environ", {"SMTP_USER": "mailer@example.com", "SMTP_APP_PASSWORD": "test-password"})
	def test_shared_sender_uses_configured_smtp_and_both_message_parts(self, smtp_factory):
		send_branded_email(
			"customer@example.com",
			"carTOGO.mnl | Test",
			"Preview",
			"Test heading",
			"Test introduction",
			"<p>HTML details</p>",
			"Plain details",
		)

		smtp_factory.assert_called_once()
		mail_server = smtp_factory.return_value.__enter__.return_value
		mail_server.starttls.assert_called_once()
		mail_server.login.assert_called_once_with("mailer@example.com", "test-password")
		message = mail_server.send_message.call_args.args[0]
		self.assertEqual(message["To"], "customer@example.com")
		self.assertIn("Plain details", message.get_body(preferencelist=("plain",)).get_content())
		self.assertIn("HTML details", message.get_body(preferencelist=("html",)).get_content())

	@patch("server.send_branded_email")
	def test_inquiry_confirmation_is_concise_branded_and_escapes_customer_values(self, send_email):
		send_inquiry_confirmation(self.inquiry)

		args = send_email.call_args.args
		self.assertEqual(args[0], "customer@example.com")
		self.assertIn("We received your inquiry", args[1])
		self.assertIn("have your driver’s license and ID ready", args[6])
		self.assertIn("No payment is due now", args[6])
		self.assertIn("Honda &lt;City&gt;", args[5])
		self.assertIn("Fairview &amp; Quezon City", args[5])
		self.assertNotIn("Alex <Customer>", args[5])

	def test_saved_inquiry_succeeds_when_confirmation_email_fails(self):
		token = "receipt-test-token"
		GUEST_EMAIL_VERIFICATIONS[token] = {
			"email": "customer@example.com",
			"expires_at": time.time() + 60,
		}
		payload = {
			"name": "Ignored name",
			"firstName": "Alex",
			"lastName": "Customer",
			"middleName": "",
			"suffix": "",
			"email": "customer@example.com",
			"emailVerificationToken": token,
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
			"rentalMode": "custom_days",
			"rentalPeriodHours": 24,
			"estimatedRentalHours": 96,
			"ratePerPeriod": 2000,
			"rentalDays": 4,
			"discountPercent": 5,
			"discountAmount": 400,
			"quotedRate": 7600,
			"notes": "",
		}
		handler = object.__new__(WebsiteHandler)
		handler.headers = {}
		handler.read_json = Mock(return_value=payload)
		handler.send_json = Mock()
		handler.log_message = Mock()
		store = Mock()
		store.add_inquiry.return_value = {"id": 42}
		with patch("server.get_mongo_store", return_value=store), \
			patch("server.lookup_target_location", return_value={"valid": True}), \
			patch("server.send_inquiry_confirmation", side_effect=RuntimeError("SMTP unavailable")):
			handler.create_inquiry()

		handler.send_json.assert_called_once_with(
			201,
			{"data": {"id": 42}, "emailNotificationSent": False},
		)
		self.assertNotIn(token, GUEST_EMAIL_VERIFICATIONS)
		handler.log_message.assert_called_once()


class InquiryRejectionTests(unittest.TestCase):
	def test_rejection_email_uses_shared_branded_template_and_escapes_reason(self):
		inquiry = {
			"email": "customer@example.com",
			"name": "Alex",
			"rejection_reason": "Vehicle <unavailable> & scheduling conflict.",
		}
		with patch("server.send_branded_email") as send_email:
			send_inquiry_rejection(inquiry)

		args = send_email.call_args.args
		self.assertEqual(args[0], "customer@example.com")
		self.assertIn("Update about your reservation inquiry", args[1])
		self.assertIn("Vehicle &lt;unavailable&gt; &amp; scheduling conflict.", args[5])
		self.assertIn("Vehicle <unavailable> & scheduling conflict.", args[6])
		self.assertIn("Alex", args[3] + args[4])

	def test_rejection_email_requires_an_email_address(self):
		with self.assertRaisesRegex(ValueError, "valid email address"):
			send_inquiry_rejection({"rejection_reason": "Unable to accommodate."})

	def make_admin_handler(self, payload):
		handler = object.__new__(WebsiteHandler)
		handler.headers = {"Authorization": "Bearer admin-token"}
		handler.get_authorized_admin = Mock(return_value={"id": "admin-1"})
		handler.read_json = Mock(return_value=payload)
		handler.send_json = Mock()
		handler.log_message = Mock()
		return handler

	def test_reject_action_stores_reason_and_reports_email_delivery(self):
		rejected = {
			"id": 42,
			"email": "customer@example.com",
			"status": "rejected",
			"rejection_reason": "Vehicle unavailable.",
			"rejection_email_sent": False,
		}
		store = Mock()
		store.reject_inquiry.return_value = rejected.copy()
		store.mark_inquiry_rejection_email_sent.return_value = {**rejected, "rejection_email_sent": True}
		handler = self.make_admin_handler({"action": "reject", "id": 42, "reason": "Vehicle unavailable."})
		with patch("server.get_mongo_store", return_value=store), \
			patch("server.send_inquiry_rejection"):
			handler.manage_inquiries()

		store.reject_inquiry.assert_called_once_with(42, "Vehicle unavailable.")
		handler.send_json.assert_called_once_with(
			200,
			{"data": {**rejected, "rejection_email_sent": True}, "emailSent": True},
		)

	def test_reject_action_keeps_status_and_reports_failed_email_delivery(self):
		rejected = {
			"id": 42,
			"email": "customer@example.com",
			"status": "rejected",
			"rejection_reason": "Vehicle unavailable.",
			"rejection_email_sent": False,
		}
		store = Mock()
		store.reject_inquiry.return_value = rejected.copy()
		handler = self.make_admin_handler({"action": "reject", "id": 42, "reason": "Vehicle unavailable."})
		with patch("server.get_mongo_store", return_value=store), \
			patch("server.send_inquiry_rejection", side_effect=RuntimeError("SMTP unavailable")):
			handler.manage_inquiries()

		store.mark_inquiry_rejection_email_sent.assert_not_called()
		handler.send_json.assert_called_once_with(
			200,
			{"data": rejected, "emailSent": False},
		)
		handler.log_message.assert_called_once()

	def test_reject_action_enforces_250_word_limit(self):
		store = Mock()
		handler = self.make_admin_handler({
			"action": "reject",
			"id": 42,
			"reason": " ".join(["reason"] * 251),
		})
		with patch("server.get_mongo_store", return_value=store):
			handler.manage_inquiries()

		store.reject_inquiry.assert_not_called()
		handler.send_json.assert_called_once_with(
			400,
			{"error": "The rejection explanation must be no more than 250 words."},
		)

	def test_reject_action_accepts_exactly_250_words(self):
		rejected = {
			"id": 42,
			"email": "customer@example.com",
			"status": "rejected",
			"rejection_reason": " ".join(["reason"] * 250),
			"rejection_email_sent": False,
		}
		store = Mock()
		store.reject_inquiry.return_value = rejected.copy()
		store.mark_inquiry_rejection_email_sent.return_value = {**rejected, "rejection_email_sent": True}
		handler = self.make_admin_handler({"action": "reject", "id": 42, "reason": rejected["rejection_reason"]})
		with patch("server.get_mongo_store", return_value=store), \
			patch("server.send_inquiry_rejection"):
			handler.manage_inquiries()

		store.reject_inquiry.assert_called_once_with(42, rejected["rejection_reason"])
		handler.send_json.assert_called_once_with(
			200,
			{"data": {**rejected, "rejection_email_sent": True}, "emailSent": True},
		)

	def test_retry_action_resends_unsent_rejection_email(self):
		rejected = {
			"id": 42,
			"email": "customer@example.com",
			"status": "rejected",
			"rejection_reason": "Vehicle unavailable.",
			"rejection_email_sent": False,
		}
		store = Mock()
		store.get_inquiry.return_value = rejected.copy()
		store.mark_inquiry_rejection_email_sent.return_value = {**rejected, "rejection_email_sent": True}
		handler = self.make_admin_handler({"action": "resend_rejection", "id": 42})
		with patch("server.get_mongo_store", return_value=store), \
			patch("server.send_inquiry_rejection") as send_email:
			handler.manage_inquiries()

		send_email.assert_called_once()
		self.assertEqual(send_email.call_args.args[0]["id"], rejected["id"])
		self.assertEqual(send_email.call_args.args[0]["rejection_reason"], rejected["rejection_reason"])
		store.mark_inquiry_rejection_email_sent.assert_called_once_with(42)
		handler.send_json.assert_called_once_with(
			200,
			{"data": {**rejected, "rejection_email_sent": True}, "emailSent": True},
		)

	def test_status_update_does_not_allow_pending_or_rejected_values(self):
		for status in ("pending_review", "rejected"):
			with self.subTest(status=status):
				store = Mock()
				handler = self.make_admin_handler({"action": "update", "id": 42, "status": status})
				with patch("server.get_mongo_store", return_value=store):
					handler.manage_inquiries()
				store.update_inquiry_status.assert_not_called()
				handler.send_json.assert_called_once_with(400, {"error": "Choose a valid inquiry status."})


class OwnerApprovalTests(unittest.TestCase):
	def make_handler(self, payload):
		handler = object.__new__(WebsiteHandler)
		handler.read_json = Mock(return_value=payload)
		handler.send_json = Mock()
		handler.log_message = Mock()
		handler.get_authorized_admin = Mock(return_value={
			"id": "admin-1",
			"email": "staff@example.com",
			"access_token": "admin-token",
		})
		handler.get_cartogo_owner_email = Mock(return_value="owner@example.com")
		return handler

	def test_direct_site_content_write_is_disabled(self):
		handler = object.__new__(WebsiteHandler)
		handler.send_json = Mock()

		handler.update_site_content()

		handler.send_json.assert_called_once_with(403, {
			"error": "Owner approval is required. Request a PIN before changing site content.",
		})

	def test_owner_pin_is_sent_to_database_designated_owner(self):
		handler = self.make_handler({
			"resource": "site_content",
			"action": "update",
			"data": {"settings": {"companyName": "carTOGO"}},
		})
		with patch.dict("os.environ", {
			"SMTP_USER": "mailer@example.com",
			"SMTP_APP_PASSWORD": "test-password",
		}), patch.dict("server.OTP_REQUESTS", {}, clear=True), \
			patch.dict("server.UNIT_APPROVALS", {}, clear=True), \
			patch("server.secrets.token_urlsafe", return_value="owner-change-challenge"), \
			patch("server.secrets.randbelow", return_value=1234), \
			patch("server.send_branded_email") as send_email:
			handler.request_owner_change()
			challenge = UNIT_APPROVALS["owner-change-challenge"].copy()

		send_email.assert_called_once()
		self.assertEqual(send_email.call_args.args[0], "owner@example.com")
		self.assertEqual(send_email.call_args.args[1], "carTOGO.mnl | Owner PIN: Update site settings and page content")
		handler.send_json.assert_called_once_with(200, {
			"challengeId": "owner-change-challenge",
			"ownerEmail": "owner@example.com",
			"expiresIn": 300,
		})
		self.assertEqual(challenge["requester_email"], "staff@example.com")
		self.assertEqual(challenge["resource"], "site_content")
		self.assertEqual(challenge["data"], {"settings": {"companyName": "carTOGO"}})

	def test_valid_owner_pin_applies_only_its_bound_change(self):
		challenge_id = "owner-change-challenge"
		code = "012345"
		challenge = {
			"resource": "site_content",
			"owner_email": "owner@example.com",
			"action": "update",
			"data": {"labels": {"about": {"title": "Updated"}}},
			"code_hash": hashlib.sha256(f"{challenge_id}:{code}".encode()).hexdigest(),
			"expires_at": time.time() + 60,
			"attempts": 0,
		}
		handler = self.make_handler({"challengeId": challenge_id, "code": code})
		handler.execute_owner_change = Mock(return_value={"labels": {"about": {"title": "Updated"}}})
		with patch.dict("server.UNIT_APPROVALS", {challenge_id: challenge}, clear=True):
			handler.approve_owner_change()

		handler.execute_owner_change.assert_called_once_with(challenge)
		handler.send_json.assert_called_once_with(
			200,
			{
				"data": {"labels": {"about": {"title": "Updated"}}},
				"resource": "site_content",
			},
		)
		self.assertNotIn(challenge_id, UNIT_APPROVALS)

	def test_owner_change_after_owner_rotation_is_rejected(self):
		challenge_id = "old-owner-challenge"
		code = "123456"
		challenge = {
			"resource": "site_content",
			"owner_email": "former-owner@example.com",
			"action": "update",
			"data": {"settings": {"companyName": "Should not apply"}},
			"code_hash": hashlib.sha256(f"{challenge_id}:{code}".encode()).hexdigest(),
			"expires_at": time.time() + 60,
			"attempts": 0,
		}
		handler = self.make_handler({"challengeId": challenge_id, "code": code})
		handler.execute_owner_change = Mock()
		with patch.dict("server.UNIT_APPROVALS", {challenge_id: challenge}, clear=True):
			handler.approve_owner_change()

		handler.execute_owner_change.assert_not_called()
		handler.send_json.assert_called_once_with(
			403,
			{"error": "The owner account changed. Request a new approval PIN."},
		)

	def test_approved_chat_delete_reports_when_session_no_longer_exists(self):
		handler = object.__new__(WebsiteHandler)
		response = MagicMock()
		response.__enter__.return_value = response
		response.read.return_value = b"[]"

		with patch.dict("os.environ", {
			"SUPABASE_URL": "https://example.supabase.co",
			"SUPABASE_SERVICE_ROLE_KEY": "service-role-key",
		}), patch("server.urlopen", return_value=response):
			with self.assertRaisesRegex(RuntimeError, "session no longer exists"):
				handler.delete_chat_session_with_service_role("session-1")


if __name__ == "__main__":
	unittest.main()
