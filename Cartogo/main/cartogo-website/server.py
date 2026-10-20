import json
import hashlib
import hmac
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
	"SUPABASE_URL", "SUPABASE_ANON_KEY",
	"MONGODB_URI", "MONGODB_DATABASE", "MONGODB_UNITS_COLLECTION",
	"MONGODB_SITE_ASSETS_COLLECTION", "MONGODB_SITE_CONTENT_COLLECTION",
	"MONGODB_INQUIRIES_COLLECTION", "MONGODB_SEQUENCES_COLLECTION",
	"SMTP_USER", "SMTP_APP_PASSWORD", "SMTP_HOST", "SMTP_PORT", "SMTP_FROM",
	"HOST", "PORT",
}
UNIT_APPROVALS = {}
UNIT_APPROVALS_LOCK = Lock()
OTP_REQUESTS = {}
OTP_REQUESTS_LOCK = Lock()
UNIT_STATUSES = {"Available", "Rented", "Maintenance", "Inactive"}
UNIT_RATE_FIELDS = ("in12_rate", "in24_rate", "out12_rate", "out24_rate", "luzon_rate")
MAX_API_BODY_BYTES = 16 * 1024
MONGO_STORE = None
MONGO_STORE_LOCK = Lock()


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
		elif request_path == "/api/site-content/update":
			self.update_site_content()
		elif request_path == "/api/inquiries":
			self.create_inquiry()
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
		try:
			self.get_authorized_admin()
			updates = self.read_json()
			content = get_mongo_store().update_site_content(updates)
			self.send_json(200, {"data": content})
		except ValueError as error:
			self.send_json(400, {"error": str(error)})
		except PermissionError as error:
			self.send_json(403, {"error": str(error)})
		except (RuntimeError, PyMongoError) as error:
			message = str(error) if isinstance(error, RuntimeError) else "MongoDB could not update site content."
			self.send_json(503, {"error": message})

	def get_admin_inquiries(self):
		try:
			self.get_authorized_admin()
			self.send_json(200, get_mongo_store().list_inquiries())
		except PermissionError as error:
			self.send_json(403, {"error": str(error)})
		except (RuntimeError, PyMongoError):
			self.send_json(503, {"error": "MongoDB inquiries are unavailable."})

	def create_inquiry(self):
		try:
			payload = self.read_json()
			user = self.get_verified_google_user()
			inquiry = self.normalize_public_inquiry(payload, user)
			result = get_mongo_store().add_inquiry(inquiry)
			self.send_json(201, {"data": result})
		except ValueError as error:
			self.send_json(400, {"error": str(error)})
		except PermissionError as error:
			self.send_json(403, {"error": str(error)})
		except (RuntimeError, PyMongoError):
			self.send_json(503, {"error": "MongoDB could not save the inquiry."})

	def manage_inquiries(self):
		try:
			self.get_authorized_admin()
			payload = self.read_json()
			action = payload.get("action")
			inquiry_id = self.normalize_inquiry_id(payload.get("id"))
			store = get_mongo_store()
			if action == "update":
				status = payload.get("status")
				if not isinstance(status, str) or status not in {"pending_review", "contacted", "confirmed", "rejected"}:
					raise ValueError("Choose a valid inquiry status.")
				result = store.update_inquiry_status(inquiry_id, status)
				self.send_json(200, {"data": result})
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

		phone = text_value("phone", "Phone number", 24)
		phone_digits = re.sub(r"\D", "", phone)
		if not 7 <= len(phone_digits) <= 15:
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
		estimated_rental_hours = number_value(
			"estimatedRentalHours", "Estimated rental hours", required=True, integer=True, minimum=1, maximum=360
		)
		rental_days = number_value("rentalDays", "Rental days", required=True, integer=True, minimum=4, maximum=15)
		discount_percent = number_value("discountPercent", "Discount percent", integer=True, maximum=10)
		if discount_percent is not None and discount_percent not in {0, 5, 10}:
			raise ValueError("Discount percent must be 0, 5, or 10.")
		rate_region = text_value("rateRegion", "Rate region", 16)
		if rate_region not in {"in", "out", "luzon"}:
			raise ValueError("Choose a valid rate region.")
		latitude = number_value("targetLatitude", "Target latitude", required=True, minimum=-90, maximum=90)
		longitude = number_value("targetLongitude", "Target longitude", required=True, minimum=-180, maximum=180)

		return {
			"name": name,
			"email": str(user["email"]).strip().lower(),
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
			"user_id": str(user["id"]),
			"verification_method": "google_oauth",
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
		return {"id": str(user["id"]), "email": str(user["email"]).strip().lower()}

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
		user_metadata = user.get("user_metadata")
		if not isinstance(user_metadata, dict):
			user_metadata = {}
		email_verified = user_metadata.get("email_verified")
		if app_metadata.get("provider") != "google" or email_verified not in (True, "true"):
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
			payload = self.read_json()
			action, unit = self.normalize_unit_change(payload)
			admin = self.get_authorized_admin()
			if not os.environ.get("SMTP_USER", "").strip() or not os.environ.get("SMTP_APP_PASSWORD", "").strip():
				raise RuntimeError("Configure Gmail SMTP credentials in the website server environment first.")
			with OTP_REQUESTS_LOCK:
				last_request = OTP_REQUESTS.get(admin["id"], 0)
				if time.time() - last_request < 60:
					raise RuntimeError("Wait one minute before requesting another approval code.")
				OTP_REQUESTS[admin["id"]] = time.time()
			challenge_id = secrets.token_urlsafe(24)
			code = f"{secrets.randbelow(1000000):06d}"
			unit_name = unit.get("display_name", f"unit #{unit.get('id')}")
			operation = {"add": "Add", "update": "Update", "delete": "Delete"}[action]
			message = EmailMessage()
			message["Subject"] = f"carTOGO unit change approval: {operation} {unit_name}"
			message["From"] = os.environ.get("SMTP_FROM", "").strip() or os.environ["SMTP_USER"].strip()
			message["To"] = admin["email"]
			message.set_content(
				f"A carTOGO administrator requested this unit change: {operation} {unit_name}.\n\n"
				f"Requested values:\n{json.dumps(unit, ensure_ascii=False, indent=2)}\n\n"
				f"Approval code: {code}\n\nThis code expires in 5 minutes and can approve only this requested change."
			)
			with UNIT_APPROVALS_LOCK:
				UNIT_APPROVALS[challenge_id] = {
					"user_id": admin["id"],
					"email": admin["email"],
					"action": action,
					"unit": unit,
					"code_hash": hashlib.sha256(f"{challenge_id}:{code}".encode()).hexdigest(),
					"expires_at": time.time() + 300,
					"attempts": 0,
				}
			try:
				with smtplib.SMTP(
					os.environ.get("SMTP_HOST", "smtp.gmail.com").strip(),
					int(os.environ.get("SMTP_PORT", "587")),
					timeout=10,
				) as mail_server:
					mail_server.starttls(context=ssl.create_default_context())
					mail_server.login(os.environ["SMTP_USER"].strip(), os.environ["SMTP_APP_PASSWORD"].strip())
					mail_server.send_message(message)
			except (OSError, smtplib.SMTPException, ValueError):
				with UNIT_APPROVALS_LOCK:
					UNIT_APPROVALS.pop(challenge_id, None)
				raise RuntimeError("Gmail could not send the approval code. Check the SMTP settings.") from None
			self.send_json(200, {"challengeId": challenge_id, "expiresIn": 300})
		except ValueError as error:
			self.send_json(400, {"error": str(error)})
		except PermissionError as error:
			self.send_json(403, {"error": str(error)})
		except RuntimeError as error:
			self.send_json(503, {"error": str(error)})

	def request_site_asset_change(self):
		try:
			payload = self.read_json()
			action, asset = self.normalize_site_asset_change(payload)
			admin = self.get_authorized_admin()
			if not os.environ.get("SMTP_USER", "").strip() or not os.environ.get("SMTP_APP_PASSWORD", "").strip():
				raise RuntimeError("Configure Gmail SMTP credentials in the website server environment first.")
			with OTP_REQUESTS_LOCK:
				last_request = OTP_REQUESTS.get(admin["id"], 0)
				if time.time() - last_request < 60:
					raise RuntimeError("Wait one minute before requesting another approval code.")
				OTP_REQUESTS[admin["id"]] = time.time()
			challenge_id = secrets.token_urlsafe(24)
			code = f"{secrets.randbelow(1000000):06d}"
			asset_name = asset.get("display_name", asset.get("loc_name", "contact details"))
			operation = {"add": "Add", "update": "Update", "delete": "Delete"}[action]
			message = EmailMessage()
			message["Subject"] = f"carTOGO site asset approval: {operation} {asset_name}"
			message["From"] = os.environ.get("SMTP_FROM", "").strip() or os.environ["SMTP_USER"].strip()
			message["To"] = admin["email"]
			message.set_content(
				f"A carTOGO administrator requested this site asset change: {operation} {asset_name}.\n\n"
				f"Requested values:\n{json.dumps(asset, ensure_ascii=False, indent=2)}\n\n"
				f"Approval code: {code}\n\nThis code expires in 5 minutes and can approve only this requested change."
			)
			with UNIT_APPROVALS_LOCK:
				UNIT_APPROVALS[challenge_id] = {
					"resource": "site_assets",
					"user_id": admin["id"],
					"email": admin["email"],
					"action": action,
					"unit": asset,
					"code_hash": hashlib.sha256(f"{challenge_id}:{code}".encode()).hexdigest(),
					"expires_at": time.time() + 300,
					"attempts": 0,
				}
			try:
				with smtplib.SMTP(
					os.environ.get("SMTP_HOST", "smtp.gmail.com").strip(),
					int(os.environ.get("SMTP_PORT", "587")),
					timeout=10,
				) as mail_server:
					mail_server.starttls(context=ssl.create_default_context())
					mail_server.login(os.environ["SMTP_USER"].strip(), os.environ["SMTP_APP_PASSWORD"].strip())
					mail_server.send_message(message)
			except (OSError, smtplib.SMTPException, ValueError):
				with UNIT_APPROVALS_LOCK:
					UNIT_APPROVALS.pop(challenge_id, None)
				raise RuntimeError("Gmail could not send the approval code. Check the SMTP settings.") from None
			self.send_json(200, {"challengeId": challenge_id, "expiresIn": 300})
		except ValueError as error:
			self.send_json(400, {"error": str(error)})
		except PermissionError as error:
			self.send_json(403, {"error": str(error)})
		except RuntimeError as error:
			self.send_json(503, {"error": str(error)})

	def approve_unit_change(self):
		try:
			payload = self.read_json()
			challenge_id = payload.get("challengeId")
			code = payload.get("code")
			if not isinstance(challenge_id, str) or not isinstance(code, str) or not code.isdigit() or len(code) != 6:
				raise ValueError("Enter the six-digit approval code.")
			admin = self.get_authorized_admin()
			with UNIT_APPROVALS_LOCK:
				challenge = UNIT_APPROVALS.get(challenge_id)
				if not challenge or challenge.get("resource", "unit") != "unit" or challenge["expires_at"] < time.time():
					UNIT_APPROVALS.pop(challenge_id, None)
					raise PermissionError("That approval code expired. Request a new one.")
				if challenge["user_id"] != admin["id"]:
					raise PermissionError("This approval code belongs to a different account.")
				challenge["attempts"] += 1
				expected_hash = challenge["code_hash"]
				provided_hash = hashlib.sha256(f"{challenge_id}:{code}".encode()).hexdigest()
				if challenge["attempts"] > 5 or not hmac.compare_digest(expected_hash, provided_hash):
					if challenge["attempts"] >= 5:
						UNIT_APPROVALS.pop(challenge_id, None)
					raise PermissionError("The approval code is invalid or has expired.")
				UNIT_APPROVALS.pop(challenge_id, None)
			result = self.execute_unit_change(challenge["action"], challenge["unit"])
			self.send_json(200, {"data": result})
		except ValueError as error:
			self.send_json(400, {"error": str(error)})
		except PermissionError as error:
			self.send_json(403, {"error": str(error)})
		except RuntimeError as error:
			self.send_json(503, {"error": str(error)})
		except PyMongoError:
			self.send_json(503, {"error": "MongoDB could not apply the approved unit change."})

	def approve_site_asset_change(self):
		try:
			payload = self.read_json()
			challenge_id = payload.get("challengeId")
			code = payload.get("code")
			if not isinstance(challenge_id, str) or not isinstance(code, str) or not code.isdigit() or len(code) != 6:
				raise ValueError("Enter the six-digit approval code.")
			admin = self.get_authorized_admin()
			with UNIT_APPROVALS_LOCK:
				challenge = UNIT_APPROVALS.get(challenge_id)
				if not challenge or challenge.get("resource") != "site_assets" or challenge["expires_at"] < time.time():
					UNIT_APPROVALS.pop(challenge_id, None)
					raise PermissionError("That approval code expired. Request a new one.")
				if challenge["user_id"] != admin["id"]:
					raise PermissionError("This approval code belongs to a different account.")
				challenge["attempts"] += 1
				expected_hash = challenge["code_hash"]
				provided_hash = hashlib.sha256(f"{challenge_id}:{code}".encode()).hexdigest()
				if challenge["attempts"] > 5 or not hmac.compare_digest(expected_hash, provided_hash):
					if challenge["attempts"] >= 5:
						UNIT_APPROVALS.pop(challenge_id, None)
					raise PermissionError("The approval code is invalid or has expired.")
				UNIT_APPROVALS.pop(challenge_id, None)
			result = self.execute_site_asset_change(challenge["action"], challenge["unit"])
			self.send_json(200, {"data": result})
		except ValueError as error:
			self.send_json(400, {"error": str(error)})
		except PermissionError as error:
			self.send_json(403, {"error": str(error)})
		except RuntimeError as error:
			self.send_json(503, {"error": str(error)})
		except PyMongoError:
			self.send_json(503, {"error": "MongoDB could not apply the approved site asset change."})

	def execute_unit_change(self, action, unit):
		return get_mongo_store().apply_unit_change(action, unit)

	def execute_site_asset_change(self, action, asset):
		return get_mongo_store().apply_site_asset_change(action, asset)

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