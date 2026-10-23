import json
import hashlib
import hmac
import html
import math
import os
import re
import secrets
import socket
import smtplib
import ssl
import time
from datetime import date
from email.message import EmailMessage
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, unquote, urlsplit
from urllib.request import Request, urlopen

from mongo_data import MongoDataStore
from pymongo.errors import PyMongoError


ROOT = Path(__file__).resolve().parent
ENV_KEYS = {
	"SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY",
	"MONGODB_URI", "MONGODB_DATABASE", "MONGODB_UNITS_COLLECTION",
	"MONGODB_SITE_ASSETS_COLLECTION", "MONGODB_SITE_CONTENT_COLLECTION",
	"MONGODB_INQUIRIES_COLLECTION", "MONGODB_SEQUENCES_COLLECTION",
	"SMTP_USER", "SMTP_APP_PASSWORD", "SMTP_HOST", "SMTP_PORT", "SMTP_FROM",
	"GEOCODING_CONTACT_EMAIL",
	"HOST", "PORT",
}
UNIT_APPROVALS = {}
UNIT_APPROVALS_LOCK = Lock()
OTP_REQUESTS = {}
OTP_REQUESTS_LOCK = Lock()
GUEST_EMAIL_CHALLENGES = {}
GUEST_EMAIL_VERIFICATIONS = {}
GUEST_EMAIL_REQUESTS = {}
GUEST_EMAIL_LOCK = Lock()
UNIT_STATUSES = {"Available", "Rented", "Maintenance", "Inactive"}
UNIT_RATE_FIELDS = ("in12_rate", "in24_rate", "out12_rate", "out24_rate", "luzon_rate")
MAX_API_BODY_BYTES = 16 * 1024
MONGO_STORE = None
MONGO_STORE_LOCK = Lock()
TARGET_LOCATION_CACHE = {}
TARGET_LOCATION_CACHE_LOCK = Lock()
TARGET_LOCATION_REQUEST_LOCK = Lock()
TARGET_LOCATION_LAST_REQUEST_AT = 0
TARGET_LOCATION_CACHE_TTL = 86400


class TargetLocationServiceError(RuntimeError):
	pass


def build_branded_email(subject, preheader, heading, intro, content_html, text_content):
	message = EmailMessage()
	message["Subject"] = subject.replace("\r", " ").replace("\n", " ").strip()
	message.set_content(text_content)
	message.add_alternative(
		f"""<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>{html.escape(heading)}</title></head>
<body style="margin:0;padding:0;background:#f3f5f7;font-family:Arial,Helvetica,sans-serif;color:#252525;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">{html.escape(preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f3f5f7;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;">
        <tr><td style="padding:22px 28px;background:#202020;border-bottom:4px solid #d62828;color:#ffffff;">
          <div style="font-size:20px;font-weight:800;letter-spacing:.3px;">carTOGO<span style="color:#ff665e;">.mnl</span></div>
          <div style="margin-top:4px;color:#c9c9c9;font-size:11px;letter-spacing:1.2px;text-transform:uppercase;">Reliable cars · Easy booking</div>
        </td></tr>
        <tr><td style="padding:30px 28px 22px;">
          <h1 style="margin:0 0 12px;color:#202020;font-size:23px;line-height:1.3;">{html.escape(heading)}</h1>
          <p style="margin:0 0 22px;color:#565e67;font-size:15px;line-height:1.65;">{html.escape(intro)}</p>
          {content_html}
        </td></tr>
        <tr><td style="padding:16px 28px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px;line-height:1.6;">
          This is an automated message from carTOGO.mnl. If you did not expect it, you can safely ignore it.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>""",
		subtype="html",
	)
	return message


def send_branded_email(recipient, subject, preheader, heading, intro, content_html, text_content):
	smtp_user = os.environ.get("SMTP_USER", "").strip()
	smtp_password = os.environ.get("SMTP_APP_PASSWORD", "").strip()
	if not smtp_user or not smtp_password:
		raise RuntimeError("Email delivery is unavailable until Gmail SMTP is configured.")
	message = build_branded_email(subject, preheader, heading, intro, content_html, text_content)
	message["From"] = os.environ.get("SMTP_FROM", "").strip() or smtp_user
	message["To"] = recipient
	with smtplib.SMTP(
		os.environ.get("SMTP_HOST", "smtp.gmail.com").strip(),
		int(os.environ.get("SMTP_PORT", "587")),
		timeout=10,
	) as mail_server:
		mail_server.starttls(context=ssl.create_default_context())
		mail_server.login(smtp_user, smtp_password)
		mail_server.send_message(message)


def send_inquiry_confirmation(inquiry):
	name = inquiry["name"]
	rental_description = (
		f'{inquiry["rental_period_hours"]}-hour rental'
		if inquiry["rental_mode"] == "hourly"
		else f'{inquiry["rental_days"]}-day custom arrangement'
	)
	quote = inquiry.get("quoted_rate")
	quote_text = f'₱{quote:,.2f} estimated' if isinstance(quote, (int, float)) else "To be confirmed"
	details = [
		("Vehicle", inquiry["car_name"]),
		("Rental", rental_description),
		("Pickup", f'{inquiry["pickup_date"]} at {inquiry["pickup_time"]}'),
		("Return", inquiry["return_date"]),
		("Destination", inquiry["location"]),
		("Estimated rental", quote_text),
	]
	details_html = "".join(
		f'<tr><td style="padding:9px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:13px;">'
		f'{html.escape(label)}</td><td style="padding:9px 12px;border-bottom:1px solid #e5e7eb;'
		f'color:#252525;font-size:13px;font-weight:600;">{html.escape(str(value))}</td></tr>'
		for label, value in details
	)
	body_html = (
		'<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" '
		'style="border:1px solid #e5e7eb;border-radius:9px;overflow:hidden;">'
		f"{details_html}</table>"
		'<div style="margin-top:20px;padding:15px 16px;border-left:3px solid #d62828;'
		'background:#fff6f5;color:#444;font-size:13px;line-height:1.65;">'
		'<strong>What happens next?</strong><br>Our team will review availability and follow up using the contact details you provided. '
		'Keep your phone nearby, and have your driver’s license and ID ready. No payment is due now.</div>'
	)
	text_details = "\n".join(f"{label}: {value}" for label, value in details)
	send_branded_email(
		inquiry["email"],
		"carTOGO.mnl | We received your inquiry",
		"Your booking inquiry has been received. Our team will follow up shortly.",
		"We’ve received your inquiry",
		f"Thank you, {name}. Our team will review your request and follow up shortly.",
		body_html,
		f"Thank you, {name}. We’ve received your inquiry and our team will review your request and follow up shortly.\n\n"
		f"{text_details}\n\nWhat happens next? Keep your phone nearby, and have your driver’s license and ID ready. "
		"No payment is due now.",
	)


def send_inquiry_rejection(inquiry):
	reason = str(inquiry.get("rejection_reason") or "").strip()
	if not reason:
		raise ValueError("A rejection reason is required before sending the customer notification.")
	recipient = inquiry.get("email")
	if not isinstance(recipient, str) or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", recipient):
		raise ValueError("This inquiry does not have a valid email address for the rejection notice.")
	name = str(inquiry.get("name") or "customer")
	content_html = (
		'<div style="padding:16px;border:1px solid #f1d4d1;border-radius:9px;'
		'background:#fff6f5;color:#343a40;font-size:14px;line-height:1.7;">'
		'<strong>Reason for this decision</strong><br>'
		f'<span style="white-space:pre-wrap;">{html.escape(reason)}</span></div>'
		'<p style="margin:20px 0 0;color:#565e67;font-size:14px;line-height:1.65;">'
		'Thank you for considering carTOGO.mnl. Please contact our team if you have questions '
		'or would like help with another option.</p>'
	)
	send_branded_email(
		recipient,
		"carTOGO.mnl | Update about your reservation inquiry",
		"We’re unable to proceed with your reservation inquiry.",
		"Update on your reservation inquiry",
		f"Dear {name}, we’re sorry, but we’re unable to proceed with your reservation inquiry.",
		content_html,
		f"Dear {name},\n\nWe’re sorry, but we’re unable to proceed with your reservation inquiry.\n\n"
		f"Reason: {reason}\n\nThank you for considering carTOGO.mnl. Please contact our team if you have "
		"questions or would like help with another option.",
	)


def get_mongo_store():
	global MONGO_STORE
	if MONGO_STORE is not None:
		return MONGO_STORE
	with MONGO_STORE_LOCK:
		if MONGO_STORE is None:
			MONGO_STORE = MongoDataStore.from_environment()
	return MONGO_STORE


def load_local_environment():
	path = ROOT / ".env"
	if not path.exists():
		return

	for line in path.read_text(encoding="utf-8").splitlines():
		line = line.strip()
		if not line or line.startswith("#") or "=" not in line:
			continue
		name, value = line.split("=", 1)
		name = name.strip()
		value = value.strip()
		if name not in ENV_KEYS or name in os.environ:
			continue
		if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
			value = value[1:-1]
		os.environ[name] = value


def assess_target_location(result):
	label = str(result.get("display_name") or "") if isinstance(result, dict) else ""
	if not isinstance(result, dict) or not isinstance(result.get("address"), dict):
		return {
			"valid": False,
			"label": label,
			"reason": "We couldn't verify this location. Choose a mapped residential area near a road.",
		}

	address = result["address"]
	category = str(result.get("category") or result.get("class") or "").lower()
	feature_type = str(result.get("type") or "").lower()
	blocked_categories = {
		"natural", "waterway", "railway", "aeroway", "military",
		"amenity", "shop", "office", "tourism", "leisure", "craft",
	}
	blocked_types = {
		"bay", "beach", "cliff", "coastline", "forest", "glacier", "lake", "marsh",
		"mountain", "ocean", "peak", "reservoir", "river", "sea", "wetland", "wood",
		"airport", "commercial", "industrial", "retail", "warehouse", "island", "islet",
	}
	has_road = any(address.get(key) for key in ("road", "pedestrian", "living_street"))
	has_settlement = any(address.get(key) for key in (
		"neighbourhood", "suburb", "city_district", "city", "town", "village", "hamlet"
	))
	residential_context = (
		(category == "building" and feature_type in {
			"apartments", "bungalow", "detached", "house", "residential", "semidetached_house", "terrace"
		})
		or (category == "landuse" and feature_type == "residential")
		or (category == "place" and feature_type in {"neighbourhood", "suburb", "village", "hamlet"})
		or (category == "highway" and feature_type in {
			"living_street", "residential", "road", "service", "tertiary", "tertiary_link", "unclassified"
		})
	)
	if category in blocked_categories or feature_type in blocked_types:
		return {
			"valid": False,
			"label": label,
			"reason": "Choose a road-connected residential location, not water, natural terrain, or a non-residential site.",
		}
	if not has_road or not has_settlement or not residential_context:
		return {
			"valid": False,
			"label": label,
			"reason": "We couldn't verify a mapped residential road or building in a populated area. Choose a clearer location within a town or neighborhood.",
		}
	return {
		"valid": True,
		"label": label,
		"address": address,
		"category": category,
		"type": feature_type,
	}


def lookup_target_location(latitude, longitude):
	global TARGET_LOCATION_LAST_REQUEST_AT
	cache_key = (round(latitude, 6), round(longitude, 6))
	now = time.time()
	with TARGET_LOCATION_CACHE_LOCK:
		cached = TARGET_LOCATION_CACHE.get(cache_key)
		if cached and now - cached[0] < TARGET_LOCATION_CACHE_TTL:
			return cached[1]

	query = urlencode({
		"format": "jsonv2",
		"lat": f"{latitude:.6f}",
		"lon": f"{longitude:.6f}",
		"zoom": "18",
		"addressdetails": "1",
	})
	contact_email = os.environ.get("GEOCODING_CONTACT_EMAIL", "").strip()
	user_agent = "carTOGO.mnl website location validation"
	if contact_email:
		user_agent += f" ({contact_email})"
	request = Request(
		f"https://nominatim.openstreetmap.org/reverse?{query}",
		headers={"Accept": "application/json", "User-Agent": user_agent},
	)
	with TARGET_LOCATION_REQUEST_LOCK:
		wait_seconds = max(0, 1.1 - (time.time() - TARGET_LOCATION_LAST_REQUEST_AT))
		if wait_seconds:
			time.sleep(wait_seconds)
		TARGET_LOCATION_LAST_REQUEST_AT = time.time()
		try:
			with urlopen(request, timeout=8) as response:
				result = json.loads(response.read())
		except (HTTPError, URLError, TimeoutError, OSError, json.JSONDecodeError) as error:
			raise TargetLocationServiceError(
				"Location verification is temporarily unavailable. Please try again."
			) from error

	assessment = assess_target_location(result)
	with TARGET_LOCATION_CACHE_LOCK:
		TARGET_LOCATION_CACHE[cache_key] = (time.time(), assessment)
	return assessment


class WebsiteHandler(SimpleHTTPRequestHandler):
	def __init__(self, *args, **kwargs):
		super().__init__(*args, directory=str(ROOT), **kwargs)

	def translate_path(self, path):
		request_path = unquote(urlsplit(path).path)
		if any(part.startswith(".") for part in Path(request_path).parts):
			return str(ROOT / "__not_found__")
		return super().translate_path(path)

	def do_GET(self):
		request_path = unquote(urlsplit(self.path).path)
		if request_path == "/":
			self.send_response(302)
			self.send_header("Location", "/front/")
			self.end_headers()
			return
		if any(part.startswith(".") for part in Path(request_path).parts):
			self.send_error(404)
			return
		if request_path == "/config.js":
			self.send_config()
			return
		if request_path == "/api/admin/inquiries":
			self.get_admin_inquiries()
			return
		if request_path in {
			"/api/public/units",
			"/api/admin/units",
			"/api/site-assets",
			"/api/admin/site-assets",
			"/api/site-content",
			"/api/site-content/defaults",
		}:
			self.get_site_data(request_path)
			return
		super().do_GET()

	def do_POST(self):
		request_path = urlsplit(self.path).path
		if request_path == "/api/unit-data/request":
			self.request_unit_change()
		elif request_path == "/api/unit-data/approve":
			self.approve_unit_change()
		elif request_path == "/api/site-assets/request":
			self.request_site_asset_change()
		elif request_path == "/api/site-assets/approve":
			self.approve_site_asset_change()
		elif request_path == "/api/admin/owner-change/request":
			self.request_owner_change()
		elif request_path == "/api/admin/owner-change/approve":
			self.approve_owner_change()
		elif request_path == "/api/site-content/update":
			self.update_site_content()
		elif request_path == "/api/inquiries":
			self.create_inquiry()
		elif request_path == "/api/target-location/validate":
			self.validate_target_location()
		elif request_path == "/api/email-verification/request":
			self.request_guest_email_verification()
		elif request_path == "/api/email-verification/verify":
			self.verify_guest_email()
		elif request_path == "/api/admin/inquiries":
			self.manage_inquiries()
		else:
			self.send_json(404, {"error": "Not found."})

	def get_site_data(self, request_path):
		try:
			if request_path == "/api/public/units":
				result = get_mongo_store().list_units()
			elif request_path == "/api/admin/units":
				self.get_authorized_admin()
				result = get_mongo_store().list_units(include_inactive=True)
			elif request_path == "/api/site-assets":
				result = get_mongo_store().list_site_assets()
			elif request_path == "/api/admin/site-assets":
				self.get_authorized_admin()
				result = get_mongo_store().list_site_assets()
			elif request_path == "/api/site-content":
				result = get_mongo_store().get_site_content()
			else:
				seed_path = ROOT / "back" / "data" / "site_content_seed.json"
				result = json.loads(seed_path.read_text(encoding="utf-8"))
			self.send_json(200, result)
		except PermissionError as error:
			self.send_json(403, {"error": str(error)})
		except (RuntimeError, PyMongoError, OSError, json.JSONDecodeError) as error:
			message = str(error) if isinstance(error, RuntimeError) else "MongoDB site data is unavailable."
			self.send_json(503, {"error": message})

	def update_site_content(self):
		self.send_json(403, {"error": "Owner approval is required. Request a PIN before changing site content."})

	def get_admin_inquiries(self):
		try:
			self.get_authorized_admin()
			self.send_json(200, get_mongo_store().list_inquiries())
		except PermissionError as error:
			self.send_json(403, {"error": str(error)})
		except (RuntimeError, PyMongoError, ValueError):
			self.send_json(503, {"error": "MongoDB inquiries are unavailable."})

	def create_inquiry(self):
		try:
			payload = self.read_json()
			user = self.get_verified_google_user() if self.headers.get("Authorization") else None
			inquiry = self.normalize_public_inquiry(payload, user)
			location_result = lookup_target_location(
				inquiry["target_latitude"], inquiry["target_longitude"]
			)
			if not location_result["valid"]:
				raise ValueError(location_result["reason"])
			email_verification_token = None
			if not user:
				email_verification_token = payload.get("emailVerificationToken")
				if not self.claim_guest_email_verification(email_verification_token, inquiry["email"]):
					raise ValueError("Verify your email address before submitting the inquiry.")
			try:
				result = get_mongo_store().add_inquiry(inquiry)
			except (RuntimeError, PyMongoError, ValueError):
				if email_verification_token:
					self.finish_guest_email_verification(email_verification_token, consume=False)
				raise
			if email_verification_token:
				self.finish_guest_email_verification(email_verification_token, consume=True)
			email_notification_sent = True
			try:
				send_inquiry_confirmation(inquiry)
			except (OSError, RuntimeError, smtplib.SMTPException, ValueError) as error:
				email_notification_sent = False
				self.log_message(
					"Inquiry %s was saved, but its confirmation email could not be sent: %s",
					result.get("id", "unknown"),
					error,
				)
			self.send_json(201, {"data": result, "emailNotificationSent": email_notification_sent})
		except ValueError as error:
			self.send_json(400, {"error": str(error)})
		except PermissionError as error:
			self.send_json(403, {"error": str(error)})
		except TargetLocationServiceError as error:
			self.send_json(503, {"error": str(error)})
		except (RuntimeError, PyMongoError):
			self.send_json(503, {"error": "MongoDB could not save the inquiry."})

	def validate_target_location(self):
		try:
			payload = self.read_json()
			latitude = payload.get("latitude")
			longitude = payload.get("longitude")
			if isinstance(latitude, bool) or not isinstance(latitude, (int, float)) or not -90 <= latitude <= 90:
				raise ValueError("Latitude must be between -90 and 90.")
			if isinstance(longitude, bool) or not isinstance(longitude, (int, float)) or not -180 <= longitude <= 180:
				raise ValueError("Longitude must be between -180 and 180.")
			self.send_json(200, lookup_target_location(float(latitude), float(longitude)))
		except ValueError as error:
			self.send_json(400, {"error": str(error)})
		except RuntimeError as error:
			self.send_json(503, {"error": str(error)})

	def request_guest_email_verification(self):
		try:
			payload = self.read_json()
			email = payload.get("email")
			if not isinstance(email, str):
				raise ValueError("Enter a valid email address.")
			email = email.strip().lower()
			if len(email) > 254 or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
				raise ValueError("Enter a valid email address.")
			smtp_user = os.environ.get("SMTP_USER", "").strip()
			smtp_password = os.environ.get("SMTP_APP_PASSWORD", "").strip()
			if not smtp_user or not smtp_password:
				raise RuntimeError("Guest email verification is unavailable until Gmail SMTP is configured.")

			now = time.time()
			client_ip = self.client_address[0]
			request_key = f"{client_ip}:{email}"
			with GUEST_EMAIL_LOCK:
				for old_key, requested_at in list(GUEST_EMAIL_REQUESTS.items()):
					if now - requested_at > 600:
						GUEST_EMAIL_REQUESTS.pop(old_key, None)
				for old_challenge, data in list(GUEST_EMAIL_CHALLENGES.items()):
					if data["expires_at"] < now:
						GUEST_EMAIL_CHALLENGES.pop(old_challenge, None)
				for old_token, data in list(GUEST_EMAIL_VERIFICATIONS.items()):
					if data["expires_at"] < now:
						GUEST_EMAIL_VERIFICATIONS.pop(old_token, None)
				last_request = GUEST_EMAIL_REQUESTS.get(request_key, 0)
				if now - last_request < 60:
					raise ValueError("Wait one minute before requesting another verification code.")
				GUEST_EMAIL_REQUESTS[request_key] = now
			challenge_id = secrets.token_urlsafe(24)
			code = f"{secrets.randbelow(1000000):06d}"
			with GUEST_EMAIL_LOCK:
				GUEST_EMAIL_CHALLENGES[challenge_id] = {
					"email": email,
					"code_hash": hashlib.sha256(f"{challenge_id}:{code}".encode()).hexdigest(),
					"expires_at": now + 600,
					"attempts": 0,
				}
			code_html = (
				'<div style="padding:18px 20px;border:1px solid #f1d4d1;border-radius:10px;'
				'background:#fff6f5;text-align:center;">'
				'<div style="color:#6b7280;font-size:12px;letter-spacing:1px;text-transform:uppercase;">Verification code</div>'
				f'<div style="margin:8px 0;color:#202020;font-family:monospace;font-size:34px;'
				f'font-weight:700;letter-spacing:8px;">{code}</div>'
				'<div style="color:#6b7280;font-size:13px;">Expires in 10 minutes · single use</div></div>'
			)
			try:
				send_branded_email(
					email,
					"carTOGO.mnl | Verify your email",
					"Use this one-time code to verify your email address.",
					"Verify your email address",
					"Enter this code on the booking page to continue with your inquiry.",
					code_html,
					f"Your carTOGO.mnl verification code is {code}. It expires in 10 minutes and can be used once. "
					"If you did not request this code, ignore this email.",
				)
			except (OSError, smtplib.SMTPException, ValueError):
				with GUEST_EMAIL_LOCK:
					GUEST_EMAIL_CHALLENGES.pop(challenge_id, None)
				raise RuntimeError("Gmail could not send the verification code. Check the website SMTP settings.") from None
			self.send_json(200, {"challengeId": challenge_id, "expiresIn": 600})
		except ValueError as error:
			self.send_json(400, {"error": str(error)})
		except RuntimeError as error:
			self.send_json(503, {"error": str(error)})

	def verify_guest_email(self):
		try:
			payload = self.read_json()
			challenge_id = payload.get("challengeId")
			code = payload.get("code")
			if not isinstance(challenge_id, str) or not isinstance(code, str) or not re.fullmatch(r"\d{6}", code):
				raise ValueError("Enter the six-digit verification code from your email.")
			with GUEST_EMAIL_LOCK:
				challenge = GUEST_EMAIL_CHALLENGES.get(challenge_id)
				if not challenge or challenge["expires_at"] < time.time():
					GUEST_EMAIL_CHALLENGES.pop(challenge_id, None)
					raise ValueError("That verification code expired. Request a new one.")
				challenge["attempts"] += 1
				expected_hash = challenge["code_hash"]
				provided_hash = hashlib.sha256(f"{challenge_id}:{code}".encode()).hexdigest()
				if challenge["attempts"] > 5 or not hmac.compare_digest(expected_hash, provided_hash):
					if challenge["attempts"] >= 5:
						GUEST_EMAIL_CHALLENGES.pop(challenge_id, None)
					raise ValueError("The verification code is incorrect or expired.")
				GUEST_EMAIL_CHALLENGES.pop(challenge_id, None)
				token = secrets.token_urlsafe(32)
				GUEST_EMAIL_VERIFICATIONS[token] = {
					"email": challenge["email"],
					"expires_at": time.time() + 600,
				}
			self.send_json(200, {"verificationToken": token, "expiresIn": 600})
		except ValueError as error:
			self.send_json(400, {"error": str(error)})

	@staticmethod
	def claim_guest_email_verification(token, email):
		if not isinstance(token, str) or not token:
			return False
		with GUEST_EMAIL_LOCK:
			verification = GUEST_EMAIL_VERIFICATIONS.get(token)
			if not verification or verification["expires_at"] < time.time():
				GUEST_EMAIL_VERIFICATIONS.pop(token, None)
				return False
			if verification["email"] != email or verification.get("in_use"):
				return False
			verification["in_use"] = True
			return True

	@staticmethod
	def finish_guest_email_verification(token, consume):
		with GUEST_EMAIL_LOCK:
			verification = GUEST_EMAIL_VERIFICATIONS.get(token)
			if not verification:
				return
			if consume:
				GUEST_EMAIL_VERIFICATIONS.pop(token, None)
			else:
				verification.pop("in_use", None)

	def manage_inquiries(self):
		try:
			self.get_authorized_admin()
			payload = self.read_json()
			action = payload.get("action")
			inquiry_id = self.normalize_inquiry_id(payload.get("id"))
			store = get_mongo_store()
			if action == "update":
				status = payload.get("status")
				if not isinstance(status, str) or status not in {"contacted", "confirmed"}:
					raise ValueError("Choose a valid inquiry status.")
				result = store.update_inquiry_status(inquiry_id, status)
				self.send_json(200, {"data": result})
			elif action == "reject":
				reason = payload.get("reason")
				if not isinstance(reason, str):
					raise ValueError("Enter a reason to include in the rejection email.")
				reason = reason.strip()
				if not reason:
					raise ValueError("Enter a reason to include in the rejection email.")
				if len(reason) > 3000:
					raise ValueError("The rejection reason is too long.")
				if len(reason.split()) > 250:
					raise ValueError("The rejection explanation must be no more than 250 words.")
				result = store.reject_inquiry(inquiry_id, reason)
				email_sent = self.send_rejection_email(store, result)
				result["rejection_email_sent"] = email_sent
				self.send_json(200, {"data": result, "emailSent": email_sent})
			elif action == "resend_rejection":
				result = store.get_inquiry(inquiry_id)
				if not result or result.get("status") != "rejected":
					raise RuntimeError("Only a rejected inquiry can receive a rejection email.")
				if result.get("rejection_email_sent"):
					raise RuntimeError("The rejection email has already been sent.")
				email_sent = self.send_rejection_email(store, result)
				result["rejection_email_sent"] = email_sent
				self.send_json(200, {"data": result, "emailSent": email_sent})
			elif action == "delete":
				store.delete_inquiry(inquiry_id)
				self.send_json(200, {"data": {"id": inquiry_id}})
			else:
				raise ValueError("Choose a valid inquiry action.")
		except ValueError as error:
			self.send_json(400, {"error": str(error)})
		except PermissionError as error:
			self.send_json(403, {"error": str(error)})
		except RuntimeError as error:
			self.send_json(404 if "no longer exists" in str(error) else 503, {"error": str(error)})
		except PyMongoError:
			self.send_json(503, {"error": "MongoDB could not apply the inquiry change."})

	def send_rejection_email(self, store, inquiry):
		try:
			send_inquiry_rejection(inquiry)
			store.mark_inquiry_rejection_email_sent(inquiry["id"])
			return True
		except (OSError, RuntimeError, smtplib.SMTPException, ValueError) as error:
			self.log_message(
				"Inquiry %s was rejected, but its notification email could not be sent: %s",
				inquiry.get("id", "unknown"),
				error,
			)
			return False

	def read_json(self):
		try:
			content_length = int(self.headers.get("Content-Length", "0"))
		except ValueError:
			raise ValueError("Invalid request body.") from None
		if content_length <= 0 or content_length > MAX_API_BODY_BYTES:
			raise ValueError("The request body is too large or empty.")
		try:
			payload = json.loads(self.rfile.read(content_length))
		except (UnicodeDecodeError, json.JSONDecodeError):
			raise ValueError("Request body must be valid JSON.") from None
		if not isinstance(payload, dict):
			raise ValueError("Request body must be a JSON object.")
		return payload

	@staticmethod
	def normalize_inquiry_id(value):
		if isinstance(value, str) and value.isdigit():
			value = int(value)
		if isinstance(value, bool) or not isinstance(value, int) or value < 1:
			raise ValueError("A valid inquiry ID is required.")
		return value

	@staticmethod
	def normalize_public_inquiry(payload, user):
		def text_value(key, label, maximum, required=True):
			value = payload.get(key)
			if value is None and not required:
				return None
			if not isinstance(value, str):
				raise ValueError(f"{label} must be text.")
			value = value.strip()
			if (required and not value) or len(value) > maximum:
				raise ValueError(f"{label} must be non-empty and no longer than {maximum} characters.")
			return value or None

		def number_value(key, label, required=False, integer=False, minimum=0, maximum=None):
			value = payload.get(key)
			if value is None and not required:
				return None
			if isinstance(value, bool) or not isinstance(value, (int, float)):
				raise ValueError(f"{label} must be a number.")
			if (
				(isinstance(value, float) and not math.isfinite(value))
				or value < minimum
				or (maximum is not None and value > maximum)
				or (integer and not isinstance(value, int))
			):
				raise ValueError(f"{label} is outside the accepted range.")
			return value

		if user:
			profile = user.get("user_metadata")
			if not isinstance(profile, dict):
				profile = {}
			name = str(profile.get("full_name") or profile.get("name") or "").strip()
			if not name:
				name = " ".join(
					str(profile.get(key) or "").strip()
					for key in ("given_name", "middle_name", "family_name")
					if str(profile.get(key) or "").strip()
				)
			if not name or len(name) > 160:
				raise ValueError("Your verified Google profile must include a name up to 160 characters.")
			email = str(user["email"]).strip().lower()
		else:
			first_name = text_value("firstName", "First name", 80)
			last_name = text_value("lastName", "Last name", 80)
			middle_name = text_value("middleName", "Middle name", 80, required=False)
			name_suffix = text_value("suffix", "Suffix", 24, required=False)
			name = f"{last_name}, {' '.join(part for part in (first_name, middle_name) if part)}"
			if name_suffix:
				name += f", {name_suffix}"
			if len(name) > 160:
				raise ValueError("Name must be no longer than 160 characters.")
			email = text_value("email", "Email", 254).lower()
			if email and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
				raise ValueError("Enter a valid email address.")

		phone = text_value("phone", "Phone number", 24, required=False)
		phone_digits = re.sub(r"\D", "", phone or "")
		if not phone or not 7 <= len(phone_digits) <= 15:
			raise ValueError("Enter a phone number with 7 to 15 digits.")
		car_id = text_value("carId", "Vehicle ID", 80)
		car_name = text_value("carName", "Vehicle name", 160)
		pickup_date = text_value("pickupDate", "Pickup date", 10)
		return_date = text_value("returnDate", "Return date", 10)
		try:
			pickup_day = date.fromisoformat(pickup_date)
			return_day = date.fromisoformat(return_date)
		except ValueError:
			raise ValueError("Pickup and return dates must use YYYY-MM-DD format.") from None
		if return_day < pickup_day:
			raise ValueError("Return date can't be earlier than the pickup date.")
		pickup_time = text_value("pickupTime", "Pickup time", 5)
		if not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", pickup_time):
			raise ValueError("Pickup time must use 24-hour HH:MM format.")

		capacity = number_value("capacity", "Capacity", integer=True, minimum=1, maximum=2147483647)
		rental_period_hours = number_value("rentalPeriodHours", "Rental period", integer=True, minimum=1, maximum=24)
		if rental_period_hours is not None and rental_period_hours not in {12, 24}:
			raise ValueError("Rental period must be 12 or 24 hours.")
		rental_mode = payload.get("rentalMode")
		if rental_mode is None:
			rental_mode = "custom_days"
		if not isinstance(rental_mode, str) or rental_mode not in {"hourly", "custom_days"}:
			raise ValueError("Choose an hourly or custom-day rental arrangement.")
		discount_percent = number_value("discountPercent", "Discount percent", integer=True, maximum=10)
		if discount_percent is not None and discount_percent not in {0, 5, 10}:
			raise ValueError("Discount percent must be 0, 5, or 10.")
		estimated_rental_hours = number_value(
			"estimatedRentalHours", "Estimated rental hours", required=True, integer=True, minimum=1, maximum=360
		)
		rental_days = number_value("rentalDays", "Rental days", required=True, integer=True, minimum=1, maximum=15)
		if rental_mode == "custom_days":
			if rental_days < 4 or estimated_rental_hours != rental_days * 24 or rental_period_hours != 24:
				raise ValueError("Custom-day rentals must use a 4–15 day duration and 24-hour rates.")
		elif (
			rental_days != 1
			or rental_period_hours not in {12, 24}
			or estimated_rental_hours != rental_period_hours
			or discount_percent not in (None, 0)
		):
			raise ValueError("Hourly rentals must be a single 12- or 24-hour block without a custom-day discount.")
		rate_region = text_value("rateRegion", "Rate region", 16)
		if rate_region not in {"in", "out", "luzon"}:
			raise ValueError("Choose a valid rate region.")
		if rental_mode == "hourly" and rate_region == "luzon":
			raise ValueError("Luzon destinations use custom-day rates.")
		if rental_mode == "hourly":
			pickup_minutes = int(pickup_time[:2]) * 60 + int(pickup_time[3:])
			expected_return_day_offset = (pickup_minutes + rental_period_hours * 60) // 1440
			if (return_day - pickup_day).days != expected_return_day_offset:
				raise ValueError("The return date must match the selected hourly rental period.")
		if rental_mode == "custom_days" and (return_day - pickup_day).days != rental_days:
			raise ValueError("The custom rental duration must match the pickup and return dates.")
		latitude = number_value("targetLatitude", "Target latitude", required=True, minimum=-90, maximum=90)
		longitude = number_value("targetLongitude", "Target longitude", required=True, minimum=-180, maximum=180)

		return {
			"name": name,
			"email": email,
			"phone": phone,
			"secondary_phone": text_value("secondaryPhone", "Secondary phone", 24, required=False),
			"car_id": car_id,
			"car_name": car_name,
			"capacity": capacity,
			"pickup_date": pickup_date,
			"pickup_time": pickup_time,
			"return_date": return_date,
			"location": text_value("location", "Target location", 500),
			"target_latitude": latitude,
			"target_longitude": longitude,
			"nearest_pickup_name": text_value("nearestPickupName", "Nearest pickup location", 160),
			"nearest_pickup_distance_km": number_value(
				"nearestPickupDistanceKm", "Nearest pickup distance", required=True, maximum=99999.999
			),
			"rate_region": rate_region,
			"rental_period_hours": rental_period_hours,
			"rental_mode": rental_mode,
			"estimated_rental_hours": estimated_rental_hours,
			"rate_per_period": number_value(
				"ratePerPeriod", "Rate per period", required=True, maximum=99999999.99
			),
			"rental_days": rental_days,
			"discount_percent": discount_percent,
			"discount_amount": number_value("discountAmount", "Discount amount", maximum=9999999999.99),
			"quoted_rate": number_value(
				"quotedRate", "Quoted rate", required=True, maximum=9999999999.99
			),
			"notes": text_value("notes", "Notes", 2000, required=False),
			"status": "confirmed",
			"user_id": str(user["id"]) if user else None,
			"verification_method": "google_oauth" if user else "guest_form",
		}

	def get_authorized_admin(self):
		token = self.headers.get("Authorization", "")
		if not token.startswith("Bearer "):
			raise PermissionError("Sign in again to continue.")
		access_token = token[7:].strip()
		base_url = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
		anon_key = os.environ.get("SUPABASE_ANON_KEY", "").strip()
		if not base_url or not anon_key:
			raise RuntimeError("Supabase URL and anon key are not configured on the website server.")

		user = self.supabase_request(
			f"{base_url}/auth/v1/user",
			anon_key,
			access_token,
		)
		if not isinstance(user, dict) or not user.get("id") or not user.get("email"):
			raise PermissionError("The signed-in account could not be verified.")
		is_admin = self.supabase_request(
			f"{base_url}/rest/v1/rpc/is_cartogo_admin",
			anon_key,
			access_token,
			method="POST",
			body=b"{}",
		)
		if is_admin is not True:
			raise PermissionError("This account is not an authorized administrator.")
		return {
			"id": str(user["id"]),
			"email": str(user["email"]).strip().lower(),
			"access_token": access_token,
		}

	def get_cartogo_owner_email(self, admin):
		base_url = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
		anon_key = os.environ.get("SUPABASE_ANON_KEY", "").strip()
		owner_email = self.supabase_request(
			f"{base_url}/rest/v1/rpc/get_cartogo_owner_email",
			anon_key,
			admin["access_token"],
			method="POST",
			body=b"{}",
		)
		if not isinstance(owner_email, str) or not re.fullmatch(
			r"[^@\s]+@[^@\s]+\.[^@\s]+", owner_email
		):
			raise RuntimeError("The database did not return a valid owner email. Run the owner-approval migration.")
		return owner_email.strip().lower()

	def get_verified_google_user(self):
		token = self.headers.get("Authorization", "")
		if not token.startswith("Bearer "):
			raise PermissionError("Sign in with a verified Google account before submitting an inquiry.")
		access_token = token[7:].strip()
		base_url = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
		anon_key = os.environ.get("SUPABASE_ANON_KEY", "").strip()
		if not base_url or not anon_key:
			raise RuntimeError("Supabase URL and anon key are not configured on the website server.")
		user = self.supabase_request(
			f"{base_url}/auth/v1/user",
			anon_key,
			access_token,
		)
		if not isinstance(user, dict) or not user.get("id") or not user.get("email"):
			raise PermissionError("The signed-in account could not be verified.")
		app_metadata = user.get("app_metadata")
		if not isinstance(app_metadata, dict):
			app_metadata = {}
		identities = user.get("identities")
		if not isinstance(identities, list):
			identities = []
		providers = app_metadata.get("providers")
		if not isinstance(providers, list):
			providers = []
		providers = {
			app_metadata.get("provider"),
			*providers,
			*(identity.get("provider") for identity in identities if isinstance(identity, dict)),
		}
		user_metadata = user.get("user_metadata")
		if not isinstance(user_metadata, dict):
			user_metadata = {}
		email_verified = user_metadata.get("email_verified") in (True, "true")
		email_confirmed = bool(user.get("email_confirmed_at") or user.get("confirmed_at"))
		if "google" not in providers or not (email_verified or email_confirmed):
			raise PermissionError("A verified Google account is required to submit an inquiry.")
		return user

	@staticmethod
	def supabase_request(url, api_key, access_token, method="GET", body=None, prefer=None):
		headers = {
			"apikey": api_key,
			"Authorization": f"Bearer {access_token}",
			"Content-Type": "application/json",
		}
		if prefer:
			headers["Prefer"] = prefer
		request = Request(url, data=body, headers=headers, method=method)
		try:
			with urlopen(request, timeout=10) as response:
				content = response.read()
		except HTTPError as error:
			if error.code in (401, 403):
				raise PermissionError("Supabase rejected the signed-in account.") from None
			raise RuntimeError("Supabase could not verify the administrator.") from None
		except (URLError, TimeoutError):
			raise RuntimeError("Could not connect to Supabase.") from None
		if not content:
			return None
		try:
			return json.loads(content)
		except json.JSONDecodeError:
			return None

	@staticmethod
	def normalize_unit_change(payload):
		action = payload.get("action")
		unit = payload.get("unit")
		if not isinstance(action, str) or action not in {"add", "update", "delete"} or not isinstance(unit, dict):
			raise ValueError("Choose a valid unit change.")
		if action == "delete":
			unit_id = unit.get("id")
			if isinstance(unit_id, bool) or not isinstance(unit_id, int) or unit_id < 1:
				raise ValueError("A valid unit ID is required for deletion.")
			display_name = unit.get("display_name")
			if not isinstance(display_name, str) or not display_name.strip() or len(display_name.strip()) > 160:
				raise ValueError("A valid unit display name is required for deletion.")
			return action, {"id": unit_id, "display_name": display_name.strip()}

		fields = ("brand", "model", "display_name")
		normalized = {}
		for field in fields:
			value = unit.get(field)
			if not isinstance(value, str) or not value.strip() or len(value.strip()) > 160:
				raise ValueError(f"Enter a valid {field.replace('_', ' ')} (up to 160 characters).")
			normalized[field] = value.strip()
		capacity = unit.get("capacity")
		if isinstance(capacity, bool) or not isinstance(capacity, int) or not 1 <= capacity <= 2147483647:
			raise ValueError("Capacity must be a positive whole number.")
		rates = {}
		for field in UNIT_RATE_FIELDS:
			rate = unit.get(field)
			if isinstance(rate, bool) or not isinstance(rate, (int, float)) or not 0 <= rate <= 99999999.99:
				raise ValueError(f"{field} must be between 0 and 99,999,999.99.")
			rates[field] = round(float(rate), 2)
		status = unit.get("status")
		if not isinstance(status, str) or status not in UNIT_STATUSES:
			raise ValueError("Choose a valid unit status.")
		features = unit.get("features")
		if not isinstance(features, list) or len(features) > 30 or any(
			not isinstance(feature, str) or len(feature.strip()) > 120 for feature in features
		):
			raise ValueError("Features must be a list of up to 30 short text values.")
		normalized.update({
			"capacity": capacity,
			**rates,
			"status": status,
			"features": [feature.strip() for feature in features if feature.strip()],
		})
		if action == "update":
			unit_id = unit.get("id")
			if isinstance(unit_id, bool) or not isinstance(unit_id, int) or unit_id < 1:
				raise ValueError("A valid unit ID is required for updates.")
			normalized["id"] = unit_id
		return action, normalized

	@staticmethod
	def normalize_site_asset_change(payload):
		action = payload.get("action")
		asset = payload.get("asset")
		if not isinstance(action, str) or action not in {"add", "update", "delete"} or not isinstance(asset, dict):
			raise ValueError("Choose a valid site asset change.")
		asset_type = asset.get("asset_type")
		if not isinstance(asset_type, str) or asset_type not in {"location", "contact"}:
			raise ValueError("Choose a location or contact record.")
		if asset_type == "contact" and action != "update":
			raise ValueError("The live-agent contact record can only be updated.")
		if action in {"update", "delete"}:
			asset_id = asset.get("id")
			if isinstance(asset_id, bool) or not isinstance(asset_id, int) or asset_id < 1:
				raise ValueError("A valid site asset ID is required.")
		else:
			asset_id = None
		if action == "delete":
			if asset_type != "location":
				raise ValueError("The live-agent contact record cannot be deleted.")
			return action, {"id": asset_id, "asset_type": asset_type, "display_name": "site location"}

		display_name = asset.get("display_name")
		if not isinstance(display_name, str) or not display_name.strip() or len(display_name.strip()) > 160:
			raise ValueError("Enter a display name up to 160 characters.")
		normalized = {
			"asset_type": asset_type,
			"display_name": display_name.strip(),
			"description": str(asset.get("description") or "").strip(),
			"status": asset.get("status", "open"),
		}
		if len(normalized["description"]) > 600:
			raise ValueError("Description must be 600 characters or fewer.")
		if not isinstance(normalized["status"], str) or normalized["status"] not in {"open", "closed"}:
			raise ValueError("Status must be open or closed.")
		if asset_type == "contact":
			phone = str(asset.get("phone") or "").strip()
			email = str(asset.get("email") or "").strip()
			operational_hours = str(asset.get("operational_hours") or "").strip()
			if len(phone) > 80 or len(email) > 254 or (email and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email)):
				raise ValueError("Enter a valid contact phone and email.")
			if len(operational_hours) > 160:
				raise ValueError("Operational hours must be 160 characters or fewer.")
			normalized.update({
				"id": asset_id,
				"phone": phone,
				"email": email,
				"operational_hours": operational_hours,
			})
			return action, normalized

		loc_name = asset.get("loc_name")
		if not isinstance(loc_name, str) or not loc_name.strip() or len(loc_name.strip()) > 120:
			raise ValueError("Enter a location name up to 120 characters.")
		coordinates = asset.get("coordinates")
		if not isinstance(coordinates, dict):
			raise ValueError("Location coordinates must include latitude and longitude.")
		latitude = coordinates.get("lat")
		longitude = coordinates.get("lng")
		if isinstance(latitude, bool) or not isinstance(latitude, (int, float)) or not -90 <= latitude <= 90:
			raise ValueError("Latitude must be between -90 and 90.")
		if isinstance(longitude, bool) or not isinstance(longitude, (int, float)) or not -180 <= longitude <= 180:
			raise ValueError("Longitude must be between -180 and 180.")
		opening = str(asset.get("opening_hours") or "").strip()
		closing = str(asset.get("closing_hours") or "").strip()
		for time_value in (opening, closing):
			if time_value and not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", time_value):
				raise ValueError("Opening and closing hours must use 24-hour HH:MM format.")
		normalized.update({
			"loc_name": loc_name.strip(),
			"coordinates": {"lat": round(float(latitude), 7), "lng": round(float(longitude), 7)},
			"opening_hours": opening or None,
			"closing_hours": closing or None,
		})
		if asset_id is not None:
			normalized["id"] = asset_id
		return action, normalized

	def request_unit_change(self):
		try:
			admin = self.get_authorized_admin()
			payload = self.read_json()
			action, unit = self.normalize_unit_change(payload)
			self.send_json(200, self.create_owner_approval(admin, "unit", action, unit))
		except ValueError as error:
			self.send_json(400, {"error": str(error)})
		except PermissionError as error:
			self.send_json(403, {"error": str(error)})
		except RuntimeError as error:
			self.send_json(503, {"error": str(error)})

	def request_site_asset_change(self):
		try:
			admin = self.get_authorized_admin()
			payload = self.read_json()
			action, asset = self.normalize_site_asset_change(payload)
			self.send_json(200, self.create_owner_approval(admin, "site_assets", action, asset))
		except ValueError as error:
			self.send_json(400, {"error": str(error)})
		except PermissionError as error:
			self.send_json(403, {"error": str(error)})
		except RuntimeError as error:
			self.send_json(503, {"error": str(error)})

	def request_owner_change(self):
		try:
			admin = self.get_authorized_admin()
			payload = self.read_json()
			resource = payload.get("resource")
			action = payload.get("action")
			data = payload.get("data")
			if resource == "unit":
				action, data = self.normalize_unit_change({"action": action, "unit": data})
			elif resource == "site_assets":
				action, data = self.normalize_site_asset_change({"action": action, "asset": data})
			elif resource == "site_content":
				if action != "update" or not isinstance(data, dict) or not data:
					raise ValueError("Choose valid site content changes.")
				if set(data) - {"settings", "labels"}:
					raise ValueError("Only settings and page labels can be updated.")
			elif resource == "admin_accounts":
				if action not in {"add", "remove"} or not isinstance(data, dict):
					raise ValueError("Choose a valid administrator account change.")
				email = data.get("email")
				if not isinstance(email, str) or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email.strip()):
					raise ValueError("Enter a valid administrator email.")
				data = {"email": email.strip().lower()}
			elif resource == "chat_sessions":
				if action != "delete" or not isinstance(data, dict):
					raise ValueError("Choose a valid chat-session change.")
				session_id = data.get("id")
				if not isinstance(session_id, str) or not session_id or len(session_id) > 200:
					raise ValueError("Choose a valid chat session.")
				data = {"id": session_id}
			else:
				raise ValueError("Choose a supported owner-approved change.")
			result = self.create_owner_approval(admin, resource, action, data)
			self.send_json(200, result)
		except ValueError as error:
			self.send_json(400, {"error": str(error)})
		except PermissionError as error:
			self.send_json(403, {"error": str(error)})
		except RuntimeError as error:
			self.send_json(503, {"error": str(error)})

	def create_owner_approval(self, admin, resource, action, data):
		if not os.environ.get("SMTP_USER", "").strip() or not os.environ.get("SMTP_APP_PASSWORD", "").strip():
			raise RuntimeError("Configure Gmail SMTP credentials in the website server environment first.")
		owner_email = self.get_cartogo_owner_email(admin)
		with OTP_REQUESTS_LOCK:
			last_request = OTP_REQUESTS.get(owner_email, 0)
			if time.time() - last_request < 60:
				raise RuntimeError("Wait one minute before requesting another owner approval PIN.")
			OTP_REQUESTS[owner_email] = time.time()

		challenge_id = secrets.token_urlsafe(24)
		code = f"{secrets.randbelow(1000000):06d}"
		operation = {"add": "Add", "update": "Update", "delete": "Delete", "remove": "Remove"}.get(action, "Change")
		pretty_resource = {
			"unit": "fleet unit",
			"site_assets": "site asset",
			"site_content": "site settings and page content",
			"admin_accounts": "administrator account",
			"chat_sessions": "chat session",
		}[resource]
		requested_values = json.dumps(data, ensure_ascii=False, indent=2)
		content_html = (
			f'<p style="margin:0 0 10px;color:#565e67;font-size:14px;line-height:1.6;">'
			f'Requested by <strong>{html.escape(admin["email"])}</strong>: '
			f'<strong>{html.escape(operation)} {html.escape(pretty_resource)}</strong></p>'
			'<pre style="overflow-wrap:anywhere;white-space:pre-wrap;padding:14px;border-radius:8px;'
			'background:#f3f5f7;color:#343a40;font-size:12px;line-height:1.5;">'
			f'{html.escape(requested_values)}</pre>'
			'<div style="margin-top:16px;padding:16px;border:1px solid #f1d4d1;border-radius:9px;'
			'background:#fff6f5;text-align:center;">'
			'<div style="color:#6b7280;font-size:12px;text-transform:uppercase;">Owner PIN · expires in 5 minutes</div>'
			f'<strong style="display:block;margin-top:8px;color:#202020;font-family:monospace;'
			f'font-size:30px;letter-spacing:7px;">{code}</strong></div>'
		)
		with UNIT_APPROVALS_LOCK:
			UNIT_APPROVALS[challenge_id] = {
				"resource": resource,
				"requester_id": admin["id"],
				"requester_email": admin["email"],
				"owner_email": owner_email,
				"action": action,
				"data": data,
				"code_hash": hashlib.sha256(f"{challenge_id}:{code}".encode()).hexdigest(),
				"expires_at": time.time() + 300,
				"attempts": 0,
			}
		try:
			send_branded_email(
				owner_email,
				f"carTOGO.mnl | Owner PIN: {operation} {pretty_resource}",
				"An admin change is awaiting your approval.",
				"Owner approval required",
				f"{admin['email']} requested to {action} {pretty_resource}. Review the request before sharing your one-time PIN.",
				content_html,
				f"Requested by {admin['email']}: {operation} {pretty_resource}.\n\n"
				f"Requested values:\n{requested_values}\n\nOwner PIN: {code}\n"
				"This PIN expires in 5 minutes and authorizes only this change.",
			)
		except (OSError, smtplib.SMTPException, ValueError):
			with UNIT_APPROVALS_LOCK:
				UNIT_APPROVALS.pop(challenge_id, None)
			raise RuntimeError("Gmail could not send the owner approval PIN. Check the SMTP settings.") from None
		return {"challengeId": challenge_id, "ownerEmail": owner_email, "expiresIn": 300}

	def approve_unit_change(self):
		self.process_owner_approval("unit")

	def approve_site_asset_change(self):
		self.process_owner_approval("site_assets")

	def approve_owner_change(self):
		self.process_owner_approval()

	def process_owner_approval(self, expected_resource=None):
		try:
			payload = self.read_json()
			challenge_id = payload.get("challengeId")
			code = payload.get("code")
			if not isinstance(challenge_id, str) or not isinstance(code, str) or not code.isdigit() or len(code) != 6:
				raise ValueError("Enter the six-digit approval code.")
			admin = self.get_authorized_admin()
			owner_email = self.get_cartogo_owner_email(admin)
			with UNIT_APPROVALS_LOCK:
				challenge = UNIT_APPROVALS.get(challenge_id)
				if (not challenge or challenge.get("expires_at", 0) < time.time()
						or (expected_resource and challenge.get("resource") != expected_resource)):
					UNIT_APPROVALS.pop(challenge_id, None)
					raise PermissionError("That approval code expired. Request a new one.")
				if challenge.get("owner_email") != owner_email:
					UNIT_APPROVALS.pop(challenge_id, None)
					raise PermissionError("The owner account changed. Request a new approval PIN.")
				challenge["attempts"] += 1
				expected_hash = challenge["code_hash"]
				provided_hash = hashlib.sha256(f"{challenge_id}:{code}".encode()).hexdigest()
				if challenge["attempts"] > 5 or not hmac.compare_digest(expected_hash, provided_hash):
					if challenge["attempts"] >= 5:
						UNIT_APPROVALS.pop(challenge_id, None)
					raise PermissionError("The approval code is invalid or has expired.")
				UNIT_APPROVALS.pop(challenge_id, None)
			result = self.execute_owner_change(challenge)
			self.send_json(200, {"data": result, "resource": challenge["resource"]})
		except ValueError as error:
			self.send_json(400, {"error": str(error)})
		except PermissionError as error:
			self.send_json(403, {"error": str(error)})
		except RuntimeError as error:
			self.send_json(503, {"error": str(error)})
		except PyMongoError:
			self.send_json(503, {"error": "MongoDB could not apply the owner-approved change."})

	def execute_unit_change(self, action, unit):
		return get_mongo_store().apply_unit_change(action, unit)

	def execute_site_asset_change(self, action, asset):
		return get_mongo_store().apply_site_asset_change(action, asset)

	def execute_owner_change(self, challenge):
		resource = challenge["resource"]
		action = challenge["action"]
		data = challenge["data"]
		if resource == "unit":
			return self.execute_unit_change(action, data)
		if resource == "site_assets":
			return self.execute_site_asset_change(action, data)
		if resource == "site_content":
			return get_mongo_store().update_site_content(data)
		if resource == "admin_accounts":
			function = "add_cartogo_admin_email" if action == "add" else "remove_cartogo_admin_email"
			return self.call_supabase_service_rpc(function, {"p_email": data["email"]})
		if resource == "chat_sessions":
			if action != "delete":
				raise ValueError("Choose a valid chat-session change.")
			self.delete_chat_session_with_service_role(data["id"])
			return {"id": data["id"]}
		raise ValueError("Choose a supported owner-approved change.")

	def call_supabase_service_rpc(self, function, parameters):
		service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
		base_url = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
		if not base_url:
			raise RuntimeError("Supabase URL is not configured on the website server.")
		if not service_key:
			raise RuntimeError("Set SUPABASE_SERVICE_ROLE_KEY on the website server to apply owner-approved admin-account changes.")
		request = Request(
			f"{base_url}/rest/v1/rpc/{function}",
			data=json.dumps(parameters).encode("utf-8"),
			headers={
				"apikey": service_key,
				"Authorization": f"Bearer {service_key}",
				"Content-Type": "application/json",
			},
			method="POST",
		)
		try:
			with urlopen(request, timeout=10) as response:
				content = response.read()
		except HTTPError as error:
			if error.code == 400:
				try:
					message = json.loads(error.read()).get("message")
				except (UnicodeDecodeError, json.JSONDecodeError, AttributeError):
					message = None
				raise ValueError(message or "Supabase rejected the administrator account change.") from None
			raise RuntimeError("Supabase could not apply the approved administrator account change.") from None
		except (URLError, TimeoutError):
			raise RuntimeError("Could not connect to Supabase to apply the administrator account change.") from None
		try:
			return json.loads(content) if content else None
		except json.JSONDecodeError:
			raise RuntimeError("Supabase returned an invalid administrator account response.") from None

	def delete_chat_session_with_service_role(self, session_id):
		service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
		base_url = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
		if not base_url:
			raise RuntimeError("Supabase URL is not configured on the website server.")
		if not service_key:
			raise RuntimeError("Set SUPABASE_SERVICE_ROLE_KEY on the website server to delete owner-approved chat sessions.")
		query = urlencode({"id": f"eq.{session_id}"})
		request = Request(
			f"{base_url}/rest/v1/chat_sessions?{query}",
			headers={
				"apikey": service_key,
				"Authorization": f"Bearer {service_key}",
				"Prefer": "return=representation",
			},
			method="DELETE",
		)
		try:
			with urlopen(request, timeout=10) as response:
				deleted = json.loads(response.read())
			if not isinstance(deleted, list) or not deleted:
				raise RuntimeError("That chat session no longer exists. Refresh the list and try again.")
		except HTTPError:
			raise RuntimeError("Supabase could not delete the approved chat session.") from None
		except (URLError, TimeoutError):
			raise RuntimeError("Could not connect to Supabase to delete the chat session.") from None

	def send_json(self, status, payload):
		body = json.dumps(payload).encode("utf-8")
		self.send_response(status)
		self.send_header("Content-Type", "application/json; charset=utf-8")
		self.send_header("Cache-Control", "no-store")
		self.send_header("Content-Length", str(len(body)))
		self.end_headers()
		self.wfile.write(body)

	def send_config(self):
		config = {
			"supabaseUrl": os.environ.get("SUPABASE_URL", "").strip(),
			"supabaseAnonKey": os.environ.get("SUPABASE_ANON_KEY", "").strip(),
		}
		if not all(config.values()):
			self.send_error(503, "Set SUPABASE_URL and SUPABASE_ANON_KEY in main/cartogo-website/.env.")
			return

		body = f"window.CARTOGO_CONFIG = {json.dumps(config)};".encode("utf-8")
		self.send_response(200)
		self.send_header("Content-Type", "application/javascript; charset=utf-8")
		self.send_header("Cache-Control", "no-store")
		self.send_header("Content-Length", str(len(body)))
		self.end_headers()
		self.wfile.write(body)


if __name__ == "__main__":
	load_local_environment()
	host = os.environ.get("HOST", "0.0.0.0")
	port = int(os.environ.get("PORT", "8000"))
	server = ThreadingHTTPServer((host, port), WebsiteHandler)
	print(f"Local access: http://127.0.0.1:{port}/front/")
	lan_addresses = {
		info[4][0]
		for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)
		if not info[4][0].startswith(("127.", "169.254."))
	}
	for address in sorted(lan_addresses):
		print(f"LAN access: http://{address}:{port}/front/")
	server.serve_forever()