import json
import hashlib
import hmac
import os
import secrets
import socket
import smtplib
import ssl
import time
from email.message import EmailMessage
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, unquote, urlsplit
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent
ENV_KEYS = {
	"SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY",
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
		super().do_GET()

	def do_POST(self):
		request_path = urlsplit(self.path).path
		if request_path == "/api/unit-data/request":
			self.request_unit_change()
		elif request_path == "/api/unit-data/approve":
			self.approve_unit_change()
		else:
			self.send_json(404, {"error": "Not found."})

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

	def request_unit_change(self):
		try:
			payload = self.read_json()
			action, unit = self.normalize_unit_change(payload)
			admin = self.get_authorized_admin()
			if not os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip():
				raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY is not configured on the website server.")
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
				if not challenge or challenge["expires_at"] < time.time():
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

	@staticmethod
	def execute_unit_change(action, unit):
		base_url = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
		service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
		query = "?" + urlencode({"id": "eq." + str(unit["id"])}) if action != "add" else ""
		url = f"{base_url}/rest/v1/unit_data{query}"
		method = {"add": "POST", "update": "PATCH", "delete": "DELETE"}[action]
		body = None if action == "delete" else json.dumps(unit).encode()
		request = Request(url, data=body, method=method, headers={
			"apikey": service_key,
			"Authorization": f"Bearer {service_key}",
			"Content-Type": "application/json",
			"Prefer": "return=representation",
		})
		try:
			with urlopen(request, timeout=10) as response:
				content = response.read()
		except HTTPError:
			raise RuntimeError("Supabase could not apply the approved unit change.") from None
		except (URLError, TimeoutError):
			raise RuntimeError("Could not connect to Supabase to apply the approved change.") from None
		if not content:
			return None
		try:
			result = json.loads(content)
		except json.JSONDecodeError:
			return None
		if action != "add" and (not isinstance(result, list) or not result):
			raise RuntimeError("That unit no longer exists. Refresh the inventory and try again.")
		return result

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
	host = os.environ.get("HOST", "127.0.0.1")
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