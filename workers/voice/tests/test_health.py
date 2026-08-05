from __future__ import annotations

import unittest

from app.health import get_health_payload


class HealthPayloadTests(unittest.TestCase):
    def test_get_health_payload(self) -> None:
        payload = get_health_payload()

        self.assertTrue(payload["ok"])
        self.assertEqual(payload["service"], "voice-worker")
        self.assertIsInstance(payload["timestamp"], str)


if __name__ == "__main__":
    unittest.main()

