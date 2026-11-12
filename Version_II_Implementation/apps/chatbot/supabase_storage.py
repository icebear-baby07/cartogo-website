import json
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from uuid import uuid4


class SupabaseStorageError(RuntimeError):
	pass


class SupabaseChatbotStore:
	def __init__(self, url, service_role_key, timeout=8):
		self.url = (url or "").strip().rstrip("/")
		self.service_role_key = (service_role_key or "").strip()
		self.timeout = timeout
		if not self.url or not self.service_role_key:
			raise SupabaseStorageError(
				"Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for chatbot Supabase storage."
			)

	def request(self, path, method="GET", body=None, headers=None):
		request_headers = {
			"apikey": self.service_role_key,
			"Authorization": f"Bearer {self.service_role_key}",
			"Content-Type": "application/json",
			"Accept": "application/json",
		}
		if headers:
			request_headers.update(headers)
		encoded_body = None if body is None else json.dumps(body, separators=(",", ":")).encode("utf-8")
		request = Request(
			f"{self.url}/rest/v1/{path}",
			data=encoded_body,
			headers=request_headers,
			method=method,
		)
		try:
			with urlopen(request, timeout=self.timeout) as response:
				payload = response.read()
		except HTTPError as error:
			raise SupabaseStorageError(
				f"Supabase chatbot storage returned HTTP {error.code} for {path.split('?')[0]}."
			) from None
		except (URLError, TimeoutError, OSError):
			raise SupabaseStorageError("Supabase chatbot storage is temporarily unavailable.") from None
		if not payload:
			return None
		try:
			return json.loads(payload)
		except (UnicodeDecodeError, json.JSONDecodeError):
			raise SupabaseStorageError("Supabase chatbot storage returned invalid JSON.") from None

	def list_documents(self, table):
		documents = []
		page_size = 1000
		for offset in range(0, 100000, page_size):
			query = urlencode({"select": "document", "order": "id.asc", "limit": page_size, "offset": offset})
			rows = self.request(f"{table}?{query}")
			if not isinstance(rows, list) or any(
				not isinstance(row, dict) or not isinstance(row.get("document"), dict)
				for row in rows
			):
				raise SupabaseStorageError(f"Supabase returned invalid {table} data.")
			documents.extend(row["document"] for row in rows)
			if len(rows) < page_size:
				return documents
		raise SupabaseStorageError(f"Supabase {table} exceeded the supported page limit.")

	def get_bot_identity(self):
		return self.request("rpc/get_cartogo_chatbot_identity", method="POST", body={})

	def list_company_information(self):
		return self.list_documents("chatbot_reference_documents")

	def list_vehicles(self):
		records = self.request("rpc/list_cartogo_chatbot_fleet", method="POST", body={})
		if not isinstance(records, list) or any(not isinstance(record, dict) for record in records):
			raise SupabaseStorageError("Supabase returned invalid chatbot fleet data.")
		return records

	def insert_chat_log(self, record):
		self.request(
			"chatbot_chat_log_documents",
			method="POST",
			body={"id": str(uuid4()), "document": record},
			headers={"Prefer": "return=minimal"},
		)
