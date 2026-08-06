from __future__ import annotations

import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from app.config import ConfigurationError, get_public_config_status, load_config, load_worker_env
from app.health import get_health_payload


class HealthRequestHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            payload = json.dumps(get_health_payload()).encode("utf-8")
            self._write_json(HTTPStatus.OK, payload)
            return

        if self.path == "/config":
            payload = json.dumps(get_public_config_status()).encode("utf-8")
            status = HTTPStatus.OK if get_public_config_status()["ok"] else HTTPStatus.SERVICE_UNAVAILABLE
            self._write_json(status, payload)
            return

        if self.path != "/":
            self.send_error(HTTPStatus.NOT_FOUND, "Not Found")
            return

        try:
            config = load_config()
            config_line = f"Configured. Open {config.client_url} after the Pipecat runner starts."
        except ConfigurationError as exc:
            config_line = f"Configuration error: {exc}"

        body = (
            "Sleek Relay voice worker helper\n\n"
            "Routes:\n"
            "- /health\n"
            "- /config\n\n"
            f"{config_line}\n"
        ).encode("utf-8")

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        return

    def _write_json(self, status: HTTPStatus, payload: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


def main() -> None:
    load_worker_env()

    try:
        config = load_config()
        host = config.host
        port = config.port
    except ConfigurationError:
        status = get_public_config_status()
        host = "127.0.0.1"
        port = 8000
        print(
            "voice worker helper started with incomplete configuration. "
            f"Missing: {', '.join(status['missing']) or 'none'}"
        )

    server = ThreadingHTTPServer((host, port), HealthRequestHandler)
    print(f"voice worker listening on http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
