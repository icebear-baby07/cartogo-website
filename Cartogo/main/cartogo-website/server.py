import json
import os
import socket
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parent
ENV_KEYS = {"SUPABASE_URL", "SUPABASE_ANON_KEY", "HOST", "PORT"}


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