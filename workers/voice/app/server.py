from __future__ import annotations

import json
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from app.health import get_health_payload


class HealthRequestHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        if self.path != "/health":
            self.send_error(HTTPStatus.NOT_FOUND, "Not Found")
            return

        payload = json.dumps(get_health_payload()).encode("utf-8")

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format: str, *args: object) -> None:
        return


def main() -> None:
    host = os.environ.get("VOICE_WORKER_HOST", "127.0.0.1")
    port = int(os.environ.get("VOICE_WORKER_PORT", "8000"))
    server = ThreadingHTTPServer((host, port), HealthRequestHandler)
    print(f"voice worker listening on http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()

