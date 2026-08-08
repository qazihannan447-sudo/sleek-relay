from __future__ import annotations

import asyncio
import unittest

from app.health_route import add_health_route_to_app


class FakeApp:
    def __init__(self) -> None:
        self.routes: list[tuple[str, object, list[str]]] = []

    def add_api_route(self, path: str, endpoint: object, methods: list[str]) -> None:
        self.routes.append((path, endpoint, methods))


class HealthRouteTests(unittest.TestCase):
    def test_adds_get_health_route_once(self) -> None:
        app = FakeApp()

        self.assertTrue(add_health_route_to_app(app))
        self.assertFalse(add_health_route_to_app(app))

        self.assertEqual(len(app.routes), 1)
        path, endpoint, methods = app.routes[0]
        self.assertEqual(path, "/health")
        self.assertEqual(methods, ["GET"])

        payload = asyncio.run(endpoint())
        self.assertEqual(payload.get("status"), "ok")

    def test_skips_apps_without_route_support(self) -> None:
        self.assertFalse(add_health_route_to_app(object()))
        self.assertFalse(add_health_route_to_app(None))


if __name__ == "__main__":
    unittest.main()
