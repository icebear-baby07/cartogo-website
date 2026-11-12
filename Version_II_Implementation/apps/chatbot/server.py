#Test Comment

import json
import os
import re
import sys
from functools import partial
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from uuid import uuid4
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, unquote, urlsplit
from urllib.request import Request, urlopen

import boto3
from dotenv import load_dotenv
from pymongo import ASCENDING, DESCENDING, MongoClient

from supabase_storage import SupabaseChatbotStore


ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")
DEFAULT_SESSION = boto3.Session()
AWS_REGION = (
	os.environ.get("AWS_REGION")
	or os.environ.get("AWS_DEFAULT_REGION")
	or DEFAULT_SESSION.region_name
	or "ap-southeast-1"
)
MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "global.amazon.nova-2-lite-v1:0")
CHATBOT_STORAGE = os.environ.get("CHATBOT_STORAGE", "mongodb").strip().lower()
if CHATBOT_STORAGE not in ("mongodb", "supabase"):
	raise RuntimeError("CHATBOT_STORAGE must be either mongodb or supabase.")
MONGODB_URI = os.environ.get("MONGODB_URI", "").strip()
MONGODB_DATABASE = os.environ.get("MONGODB_DATABASE", "Site")
MONGODB_COLLECTION = os.environ.get("MONGODB_COLLECTION", "chat_logs")
MONGODB_UNITS_DATABASE = os.environ.get("MONGODB_UNITS_DATABASE", "Site")
MONGODB_UNITS_COLLECTION = os.environ.get("MONGODB_UNITS_COLLECTION", "vehicles")
MONGODB_KNOWLEDGE_DATABASE = os.environ.get("MONGODB_KNOWLEDGE_DATABASE", "KB")
MONGODB_KNOWLEDGE_COLLECTION = os.environ.get("MONGODB_KNOWLEDGE_COLLECTION", "proprietary_info_collection")
MONGODB_BOT_IDENTITY = os.environ.get("MONGODB_BOT_IDENTITY", "bot_identity")
MONGO_CLIENT = (
	MongoClient(MONGODB_URI, serverSelectionTimeoutMS=3000)
	if CHATBOT_STORAGE == "mongodb" and MONGODB_URI
	else None
)
AI_CHAT_SESSIONS_LOG = MONGO_CLIENT[MONGODB_DATABASE][MONGODB_COLLECTION] if MONGO_CLIENT else None
VEHICLE_CATALOG = MONGO_CLIENT[MONGODB_UNITS_DATABASE][MONGODB_UNITS_COLLECTION] if MONGO_CLIENT else None
PROPRIETARY_INFO_COLLECTION = (
	MONGO_CLIENT[MONGODB_KNOWLEDGE_DATABASE][MONGODB_KNOWLEDGE_COLLECTION]
	if MONGO_CLIENT
	else None
)
SUPABASE_CHATBOT_STORE = (
	SupabaseChatbotStore(
		os.environ.get("SUPABASE_URL", ""),
		os.environ.get("SUPABASE_SERVICE_ROLE_KEY", ""),
	)
	if CHATBOT_STORAGE == "supabase"
	else None
)
BOT_IDENTITY_COLLECTION = (
	MONGO_CLIENT[MONGODB_KNOWLEDGE_DATABASE][MONGODB_BOT_IDENTITY]
	if MONGO_CLIENT
	else None
)
MAX_BODY_BYTES = 48 * 1024
MAX_MESSAGES = 11
MAX_USER_MESSAGE_LENGTH = 10000
KNOWLEDGE_SEARCH_FIELDS = ("title", "content", "topic", "keywords", "tags")
KNOWLEDGE_STOP_WORDS = frozenset({
	"about", "and", "are", "can", "for", "how", "our", "the", "their", "them",
	"this", "what", "when", "where", "which", "who", "with", "you", "your",
})
MAX_KNOWLEDGE_TERMS = 8
MAX_KNOWLEDGE_RESULTS = 4
MAX_KNOWLEDGE_CONTENT_CHARS = 3000
MAX_UNIT_RESULTS = 5
MAX_UNIT_LIST_RESULTS = 100
UNIT_RATE_FIELDS = ("in12_rate", "in24_rate", "out12_rate", "out24_rate", "luzon_rate")
UNIT_QUERY_REQUIRED = re.compile(
	r"\b(?:car|cars|vehicle|vehicles|unit|units|fleet|rent|rental|available|availability|"
	r"price|prices|pricing|rate|rates|cost|capacity|seat|seats|feature|features|recommend(?:ation|ations)?)\b",
	re.IGNORECASE,
)
UNIT_QUERY_STOP_WORDS = KNOWLEDGE_STOP_WORDS | frozenset({
	"car", "cars", "vehicle", "vehicles", "unit", "units", "fleet", "rent", "rental",
	"available", "availability", "price", "prices", "pricing", "rate", "rates", "cost", "capacity",
	"seat", "seats", "feature", "features", "much", "show", "list", "tell", "do", "does",
	"have", "has", "is", "any", "option", "options", "include", "each", "every", "all",
	"recommend", "recommendation", "recommendations",
})
UNIT_LIST_QUERY = re.compile(r"\b(?:all|each|every|list|show|recommend(?:ation|ations)?)\b", re.IGNORECASE)
UNIT_AVAILABLE_QUERY = re.compile(r"\b(?:available|availability)\b", re.IGNORECASE)
UNIT_RECOMMEND_QUERY = re.compile(r"\brecommend(?:ation|ations)?\b", re.IGNORECASE)
UNIT_FOLLOW_UP_QUERY = re.compile(r"^\s*(?:what about|how about|and)\s+.+", re.IGNORECASE)
BOT_IDENTITY_RECORD_ID = "cartogo-bot-identity"
RECOMMEND_CONTACT_PATH = "/recommend-contact"
CONTACT_REQUEST = re.compile(
	r"\b(?:who\s+(?:should|can|do)\s+i\s+(?:contact|call|email|reach|speak\s+to|talk\s+to)|"
	r"who\s+(?:handles|is responsible for|deals with)|"
	r"who\s+is\s+(?:the\s+)?(?:support|customer service)\b|"
	r"how\s+(?:do|can)\s+i\s+(?:contact|reach|call)|"
	r"(?:contact|phone|email)\s+(?:details|number|address|person|info(?:rmation)?)|"
	r"(?:give|share|provide|send)\s+(?:me\s+)?(?:a\s+)?(?:contact|support|customer service)\b|"
	r"(?:support|customer service)\s+(?:contact|number|email)|"
	r"(?:contact|phonebook|directory)\s+(?:for|about))\b",
	re.IGNORECASE,
)
CARTOGO_DATA_REQUIRED = re.compile(
	r"\b(?:cartogo|booking|reservation|account|my\s+(?:trip|rental)|"
	r"your\s+(?:rental\s+)?(?:cancellation|refund|payment|pricing|price|fees?|availability|mileage|deposit|insurance|policy|policies)|"
	r"(?:cancellation|refund|availability)\s+polic(?:y|ies))\b",
	re.IGNORECASE,
)

def normalize_messages(messages):
	if not isinstance(messages, list) or not messages or len(messages) > MAX_MESSAGES:
		raise ValueError("Send up to five recent turns and a new message.")

	normalized = []
	expected_role = "user"
	for message in messages:
		if not isinstance(message, dict) or message.get("role") != expected_role:
			raise ValueError("Messages must alternate between user and assistant, starting with the user.")

		text = message.get("text")
		max_length = MAX_USER_MESSAGE_LENGTH if expected_role == "user" else MAX_BODY_BYTES
		if not isinstance(text, str) or not text.strip() or len(text) > max_length:
			raise ValueError(f"Each {expected_role} message must contain between 1 and {max_length} characters.")

		normalized.append({"role": expected_role, "content": [{"text": text.strip()}]})
		expected_role = "assistant" if expected_role == "user" else "user"

	if normalized[-1]["role"] != "user":
		raise ValueError("The conversation must end with a user message.")
	return normalized


def find_company_information(query):
	terms = list(dict.fromkeys(
		term.lower()
		for term in re.findall(r"[a-z0-9]{3,}", query, re.IGNORECASE)
		if term.lower() not in KNOWLEDGE_STOP_WORDS
	))[:MAX_KNOWLEDGE_TERMS]
	if not terms:
		return []

	if CHATBOT_STORAGE == "supabase":
		records = SUPABASE_CHATBOT_STORE.list_company_information()
	elif PROPRIETARY_INFO_COLLECTION is None:
		return []
	else:
		query_filter = {
			"$and": [
				{"record_type": {"$ne": "bot_identity"}},
				{
					"$or": [
						{field: {"$regex": re.escape(term), "$options": "i"}}
						for term in terms
						for field in KNOWLEDGE_SEARCH_FIELDS
					]
				},
			]
		}
		projection = {"_id": 0, **{field: 1 for field in KNOWLEDGE_SEARCH_FIELDS}}
		records = list(PROPRIETARY_INFO_COLLECTION.find(query_filter, projection).limit(50))

	if CHATBOT_STORAGE == "supabase":
		records = [
			record for record in records
			if record.get("record_type") != "bot_identity"
			and any(
				term in str(record.get(field, "")).lower()
				for field in KNOWLEDGE_SEARCH_FIELDS
				for term in terms
			)
		]

	def relevance(record):
		searchable_text = " ".join(str(record.get(field, "")) for field in KNOWLEDGE_SEARCH_FIELDS).lower()
		return sum(term in searchable_text for term in terms)

	minimum_relevance = max(1, (len(terms) + 1) // 2)
	records.sort(key=relevance, reverse=True)
	return [record for record in records if relevance(record) >= minimum_relevance][:MAX_KNOWLEDGE_RESULTS]


def find_unit_records(query):
	if CHATBOT_STORAGE == "supabase":
		records = SUPABASE_CHATBOT_STORE.list_vehicles()
	elif VEHICLE_CATALOG is None:
		raise RuntimeError("MongoDB vehicle catalog is not configured.")
	else:
		records = list(VEHICLE_CATALOG.find(
			{"status": {"$ne": "Inactive"}},
			{"_id": 0},
		).sort("id", ASCENDING).limit(100))

	is_list_query = bool(UNIT_LIST_QUERY.search(query))
	available_only = bool(UNIT_AVAILABLE_QUERY.search(query) or UNIT_RECOMMEND_QUERY.search(query))
	terms = list(dict.fromkeys(
		term.lower()
		for term in re.findall(r"[a-z0-9]{3,}", query, re.IGNORECASE)
		if term.lower() not in UNIT_QUERY_STOP_WORDS
	))[:MAX_KNOWLEDGE_TERMS]
	records = [
		record for record in records
		if record.get("status") != "Inactive"
	]
	records.sort(key=lambda record: record.get("id", 0))
	records = records[:100]
	if available_only:
		records = [record for record in records if record.get("status") == "Available"]

	if not terms:
		if not UNIT_QUERY_REQUIRED.search(query):
			return []
		records.sort(key=lambda record: record.get("status") == "Available", reverse=True)
		return records[:MAX_UNIT_LIST_RESULTS if is_list_query else MAX_UNIT_RESULTS]

	if is_list_query:
		records.sort(key=lambda record: record.get("status") == "Available", reverse=True)
		return records[:MAX_UNIT_LIST_RESULTS]

	def relevance(record):
		searchable_text = " ".join(str(record.get(field, "")) for field in (
			"brand", "model", "display_name", "capacity", *UNIT_RATE_FIELDS, "status", "features",
		)).lower()
		return sum(term in searchable_text for term in terms)

	minimum_relevance = max(1, (len(terms) + 1) // 2)
	records.sort(key=relevance, reverse=True)
	return [record for record in records if relevance(record) >= minimum_relevance][:MAX_UNIT_RESULTS]


def build_unit_context(records):
	if not records:
		return ""
	units = []
	for record in records:
		features = record.get("features") if isinstance(record.get("features"), list) else []
		units.append(
			f"Display name: {record.get('display_name', '')}\n"
			f"Brand: {record.get('brand', '')}\n"
			f"Model: {record.get('model', '')}\n"
			f"Capacity: {record.get('capacity', '')}\n"
			f"IN / 12-hour Metro Manila rate: {record.get('in12_rate', '')}\n"
			f"IN / 24-hour Metro Manila rate: {record.get('in24_rate', '')}\n"
			f"OUT / 12-hour neighboring-area rate: {record.get('out12_rate', '')}\n"
			f"OUT / 24-hour neighboring-area rate: {record.get('out24_rate', '')}\n"
			f"Luzon rate: {record.get('luzon_rate', '')}\n"
			f"Status: {record.get('status', '')}\n"
			f"Features: {', '.join(str(feature) for feature in features)}"
		)
	return "<unit_inventory>\n" + "\n\n".join(units) + "\n</unit_inventory>"


def format_unit_reply(records, query):
	if not records:
		return ""
	sections = []
	for record in records:
		features = record.get("features") if isinstance(record.get("features"), list) else []
		name = record.get("display_name") or "Vehicle"
		capacity = record.get("capacity")
		capacity_text = f"{capacity} passengers" if capacity is not None else "Not listed"
		rates = []
		for field, label in (
			("in12_rate", "Metro Manila, 12 hours"),
			("in24_rate", "Metro Manila, 24 hours"),
			("out12_rate", "Neighboring area, 12 hours"),
			("out24_rate", "Neighboring area, 24 hours"),
			("luzon_rate", "Luzon, per day"),
		):
			value = record.get(field)
			if isinstance(value, (int, float)) and not isinstance(value, bool):
				rate_text = f"PHP {value:,.2f}"
			else:
				rate_text = "Not listed"
			rates.append(f"- {label}: {rate_text}")
		section = (
			f"### {name}\n"
			f"- Capacity: {capacity_text}\n"
			f"- Status: {record.get('status') or 'Unknown'}\n"
			+ "\n".join(rates)
		)
		if features:
			section += "\n- Features: " + ", ".join(str(feature) for feature in features)
		sections.append(section)

	if UNIT_RECOMMEND_QUERY.search(query):
		intro = (
			"Here are the available vehicles from the current inventory. "
			"Tell me your passenger count, destination, budget, or preferred features "
			"and I can help narrow the choices:"
		)
	elif UNIT_AVAILABLE_QUERY.search(query):
		intro = "Here are the vehicles currently marked available:"
	else:
		intro = "Here are the vehicles matching the current inventory:"
	return intro + "\n\n" + "\n\n".join(sections)


class BotIdentityError(RuntimeError):
	pass


def get_bot_identity_instructions():
	if CHATBOT_STORAGE == "supabase":
		identity = SUPABASE_CHATBOT_STORE.get_bot_identity()
	elif BOT_IDENTITY_COLLECTION is None:
		raise BotIdentityError("MongoDB bot identity is unavailable. Configure MONGODB_URI and restart the chatbot.")
	else:
		identity = BOT_IDENTITY_COLLECTION.find_one(
			{"record_id": BOT_IDENTITY_RECORD_ID, "record_type": "bot_identity"},
			{"_id": 0},
		)
	if not identity:
		raise BotIdentityError("MongoDB bot identity record is missing. Add the configured bot identity document.")

	instructions = identity.get("instructions")
	if isinstance(instructions, str) and instructions.strip():
		return instructions.strip()

	required_fields = ("name", "role", "organization", "purpose", "voice", "capabilities", "boundaries")
	if any(field not in identity for field in required_fields):
		raise BotIdentityError(
			"MongoDB bot identity must contain non-empty instructions or the structured identity fields."
		)

	for field in ("name", "role", "organization", "purpose"):
		if not isinstance(identity[field], str) or not identity[field].strip():
			raise BotIdentityError(f"MongoDB bot identity field '{field}' must be a non-empty string.")

	voice = identity["voice"]
	if not isinstance(voice, dict):
		raise BotIdentityError("MongoDB bot identity field 'voice' must be an object.")

	def instruction_list(field, values):
		if not isinstance(values, list) or any(not isinstance(value, str) or not value.strip() for value in values):
			raise BotIdentityError(f"MongoDB bot identity field '{field}' must be a list of non-empty strings.")
		return "\n".join(f"- {value.strip()}" for value in values)

	voice_traits = instruction_list("voice.traits", voice.get("traits"))
	capabilities = instruction_list("capabilities", identity["capabilities"])
	boundaries = instruction_list("boundaries", identity["boundaries"])
	language = voice.get("language", "")
	if not isinstance(language, str):
		raise BotIdentityError("MongoDB bot identity field 'voice.language' must be a string.")

	other_names = identity.get("other_names", [])
	if other_names:
		other_names = instruction_list("other_names", other_names)
		other_names = f"\nAlso known as:\n{other_names}"
	else:
		other_names = ""

	return (
		f"You are {identity['name'].strip()}, a {identity['role'].strip()} for {identity['organization'].strip()}."
		f"{other_names}\n"
		f"Purpose: {identity['purpose'].strip()}\n"
		f"Voice traits:\n{voice_traits}\n"
		f"Language: {language.strip()}\n"
		f"Capabilities:\n{capabilities}\n"
		f"Instructions and boundaries:\n{boundaries}"
	)


def build_knowledge_context(records):
	excerpts = []
	for record in records:
		title = record.get("title")
		content = record.get("content")
		topic = record.get("topic")
		if not isinstance(content, str) or not content.strip():
			continue
		if not isinstance(title, str) or not title.strip():
			title = "Company reference"
		topic_line = f"\nTopic: {topic.strip()}" if isinstance(topic, str) and topic.strip() else ""
		excerpts.append(
			f"Title: {title.strip()}{topic_line}\nContent: {content.strip()[:MAX_KNOWLEDGE_CONTENT_CHARS]}"
		)

	if not excerpts:
		return ""
	return (
		"<company_reference>\n"
		+ "\n\n".join(excerpts)
		+ "\n</company_reference>"
	)


def is_contact_request_or_follow_up(messages):
	user_messages = [
		message["content"][0]["text"]
		for message in messages
		if message["role"] == "user"
	]
	if not user_messages:
		return False
	if CONTACT_REQUEST.search(user_messages[-1]):
		return True
	if len(user_messages) < 2 or not CONTACT_REQUEST.search(user_messages[-2]):
		return False

	previous_assistant = messages[-2]["content"][0]["text"]
	return bool(re.search(r"\b(?:contact|support|customer service|specify|clarify|which|what)\b", previous_assistant, re.IGNORECASE))


class ChatHandler(SimpleHTTPRequestHandler):
	def log_message(self, format, *args):
		message = format % args
		message = re.sub(r"[\x00-\x1f\x7f-\x9f]", "", message)
		sys.stdout.write(
			"%s - - [%s] %s\n"
			% (self.address_string(), self.log_date_time_string(), message)
		)
		sys.stdout.flush()

	def translate_path(self, path):
		request_path = unquote(urlsplit(path).path)
		if request_path in ("/", "/index.html", RECOMMEND_CONTACT_PATH):
			return str(ROOT / "index.html")
		if not request_path.startswith("/assets/"):
			return str(ROOT / "__not_found__")

		candidate = (ROOT / request_path.lstrip("/")).resolve()
		try:
			candidate.relative_to(ROOT / "assets")
		except ValueError:
			return str(ROOT / "__not_found__")
		return str(candidate)

	def do_GET(self):
		request_path = urlsplit(self.path).path
		if request_path not in ("/", "/index.html", RECOMMEND_CONTACT_PATH) and not request_path.startswith("/assets/"):
			self.send_error(404)
			return
		super().do_GET()

	def do_POST(self):
		if urlsplit(self.path).path != "/api/chat":
			self.send_error(404)
			return
		self.chat_session_id = self.headers.get("X-Session-ID", "").strip()
		if not self.chat_session_id or len(self.chat_session_id) > 128:
			self.chat_session_id = str(uuid4())
		self.chat_user_id = self.headers.get("X-User-ID", "").strip()
		if not self.chat_user_id or len(self.chat_user_id) > 128:
			self.chat_user_id = str(uuid4())
		self.chat_query = None

		try:
			content_length = int(self.headers.get("Content-Length", "0"))
		except ValueError:
			self.send_json(400, {"error": "Invalid request body."})
			return
		if content_length <= 0 or content_length > MAX_BODY_BYTES:
			self.send_json(413, {"error": "The conversation is too large. Start a new chat and try again."})
			return

		try:
			payload = json.loads(self.rfile.read(content_length))
			if isinstance(payload, dict):
				request_messages = payload.get("messages")
				if isinstance(request_messages, list):
					for message in reversed(request_messages):
						if isinstance(message, dict) and message.get("role") == "user" and isinstance(message.get("text"), str):
							self.chat_query = message["text"].strip()[:MAX_USER_MESSAGE_LENGTH]
							break
			messages = normalize_messages(payload.get("messages") if isinstance(payload, dict) else None)
		except (UnicodeDecodeError, json.JSONDecodeError):
			self.send_json(400, {"error": "Request body must be valid JSON."})
			return
		except ValueError as error:
			self.send_json(400, {"error": str(error)})
			return

		try:
			system_prompt = get_bot_identity_instructions()
		except BotIdentityError as error:
			self.log_error("Bot identity unavailable (%s)", str(error))
			self.send_json(503, {"error": str(error)})
			return
		except Exception as error:
			self.log_error("Bot identity lookup failed (%s)", type(error).__name__)
			self.send_json(503, {"error": "Bot identity could not be loaded. Check storage configuration and the identity record."})
			return

		if is_contact_request_or_follow_up(messages):
			self.send_json(200, {"reply": "To reach a Cartogo expert, select the Talk to an expert button below. I don't have verified contact details to share here."})
			return

		company_records = []
		if CHATBOT_STORAGE == "supabase" or PROPRIETARY_INFO_COLLECTION is not None:
			try:
				company_records = find_company_information(self.chat_query or "")
			except Exception as error:
				self.log_error("Company knowledge lookup failed (%s)", type(error).__name__)

		knowledge_context = build_knowledge_context(company_records)
		unit_records = []
		is_unit_follow_up = bool(UNIT_FOLLOW_UP_QUERY.search(self.chat_query or ""))
		if UNIT_QUERY_REQUIRED.search(self.chat_query or "") or is_unit_follow_up:
			try:
				unit_records = find_unit_records(self.chat_query or "")
			except Exception as error:
				self.log_error("Vehicle lookup failed (%s)", type(error).__name__)
		unit_context = build_unit_context(unit_records)
		requires_company_data = CARTOGO_DATA_REQUIRED.search(self.chat_query or "")
		requires_unit_data = UNIT_QUERY_REQUIRED.search(self.chat_query or "") or is_unit_follow_up or bool(unit_records)
		if (requires_company_data and not knowledge_context and not unit_records) or (requires_unit_data and not unit_records):
			reply = "I don't have verified information for that question, so I can't answer accurately."
			self.send_json(200, {"reply": reply})
			return
		if requires_unit_data and unit_records and not requires_company_data:
			reply = format_unit_reply(unit_records, self.chat_query or "")
			self.send_json(200, {"reply": reply})
			return

		session = boto3.Session(region_name=AWS_REGION)
		try:
			credentials = session.get_credentials()
		except Exception as error:
			self.log_error("AWS credential lookup failed (%s)", type(error).__name__)
			self.send_json(503, {"error": "AWS credentials could not be loaded. Check your AWS profile or SSO setup and required dependencies."})
			return
		if credentials is None:
			self.send_json(503, {"error": "No AWS credentials are configured for this server. Set up a local AWS profile or SSO session, then try again."})
			return

		try:
			if knowledge_context:
				system_prompt += "\n\n" + knowledge_context
			if unit_context:
				system_prompt += "\n\n" + unit_context
			response = session.client("bedrock-runtime").converse(
				modelId=MODEL_ID,
				system=[{"text": system_prompt}],
				messages=messages,
			)
			content = response.get("output", {}).get("message", {}).get("content", [])
			reply = "\n".join(block["text"] for block in content if isinstance(block, dict) and isinstance(block.get("text"), str)).strip()
			if not reply:
				raise ValueError("Bedrock returned an empty response.")
		except Exception as error:
			self.log_error("Bedrock request failed (%s)", type(error).__name__)
			self.send_json(502, {"error": "Amazon Bedrock could not complete this request. Check model access, region, and account permissions."})
			return

		self.send_json(200, {"reply": reply})

	def send_json(self, status, payload):
		if urlsplit(self.path).path == "/api/chat" and hasattr(self, "chat_session_id"):
			self.log_chat_request(status, payload)

		body = json.dumps(payload).encode("utf-8")
		self.send_response(status)
		self.send_header("Content-Type", "application/json; charset=utf-8")
		self.send_header("Cache-Control", "no-store")
		self.send_header("Content-Length", str(len(body)))
		self.end_headers()
		self.wfile.write(body)

	def log_chat_request(self, status, payload):
		record = {
			"created_at": datetime.now(timezone.utc),
			"client_ip": self.client_address[0],
			"session_id": self.chat_session_id,
			"user_id": self.chat_user_id,
			"user_query": self.chat_query,
			"bot_response": payload.get("reply") or payload.get("error"),
			"status_code": status,
			"successful": 200 <= status < 300,
		}
		try:
			if CHATBOT_STORAGE == "supabase":
				SUPABASE_CHATBOT_STORE.insert_chat_log({
					**record,
					"created_at": record["created_at"].isoformat(),
				})
			elif AI_CHAT_SESSIONS_LOG is not None:
				AI_CHAT_SESSIONS_LOG.insert_one(record)
		except Exception as error:
			self.log_error("Chat logging failed (%s)", type(error).__name__)


if __name__ == "__main__":
	port = int(os.environ.get("PORT", "8000"))
	if CHATBOT_STORAGE == "supabase":
		try:
			SUPABASE_CHATBOT_STORE.get_bot_identity()
			print("Supabase chatbot identity, logging, company knowledge, and fleet access enabled.")
		except Exception as error:
			raise SystemExit(
				f"Supabase chatbot storage setup failed ({type(error).__name__}); check the server-side Supabase configuration."
			) from None
	elif MONGO_CLIENT is None:
		print("MongoDB bot identity, logging, and company knowledge are unavailable. Set MONGODB_URI in .env; chat requests require a valid bot identity record.")
	else:
		try:
			MONGO_CLIENT.admin.command("ping")
			AI_CHAT_SESSIONS_LOG.create_index(
				[("user_id", ASCENDING), ("created_at", DESCENDING)],
				name="user_id_created_at",
			)
			AI_CHAT_SESSIONS_LOG.create_index(
				[("session_id", ASCENDING), ("created_at", ASCENDING)],
				name="session_id_created_at",
			)
		except Exception as error:
			raise SystemExit(f"MongoDB connection or index setup failed ({type(error).__name__}); check .env and database permissions.") from None
		print(f"MongoDB logging enabled: {MONGODB_DATABASE}.{MONGODB_COLLECTION}")
		print(f"Company knowledge lookup enabled: {MONGODB_KNOWLEDGE_DATABASE}.{MONGODB_KNOWLEDGE_COLLECTION}")
		print(f"Bot identity instructions: {MONGODB_KNOWLEDGE_DATABASE}.{MONGODB_BOT_IDENTITY}")
	server = ThreadingHTTPServer(
		("0.0.0.0", port),
		partial(ChatHandler, directory=str(ROOT)),
	)
	print(f"Local access: http://127.0.0.1:{port}")
	print("LAN access: use one of this computer's LAN IPv4 addresses with the same port.")
	print(f"Bedrock model: {MODEL_ID} ({AWS_REGION})")
	server.serve_forever()