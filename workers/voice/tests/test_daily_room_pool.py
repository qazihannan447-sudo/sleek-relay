from __future__ import annotations

import asyncio
import unittest

from app.daily_room_pool import (
    DailyRoomPool,
    PooledDailyRoom,
    reset_global_daily_room_pool_for_tests,
)


class DailyRoomPoolTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        reset_global_daily_room_pool_for_tests()

    def tearDown(self) -> None:
        reset_global_daily_room_pool_for_tests()

    async def test_start_creates_ready_room(self) -> None:
        created: list[tuple[str, float]] = []

        async def fake_create(*, name: str, exp_at: float) -> str:
            created.append((name, exp_at))
            return f"https://example.daily.co/{name}"

        async def fake_delete(name: str) -> None:
            return None

        pool = DailyRoomPool(
            api_key="daily-key",
            pool_size=1,
            room_ttl_hours=1.0,
            create_room=fake_create,
            delete_room=fake_delete,
            monotonic_clock=lambda: 1_000.0,
        )
        await pool.start()
        self.assertEqual(pool.size, 1)
        self.assertEqual(len(created), 1)
        self.assertTrue(created[0][0].startswith("sleek-"))
        await pool.stop()

    async def test_acquire_returns_room_and_refills(self) -> None:
        created_names: list[str] = []

        async def fake_create(*, name: str, exp_at: float) -> str:
            created_names.append(name)
            return f"https://example.daily.co/{name}"

        async def fake_delete(name: str) -> None:
            return None

        pool = DailyRoomPool(
            api_key="daily-key",
            pool_size=1,
            room_ttl_hours=1.0,
            min_remaining_secs=60,
            create_room=fake_create,
            delete_room=fake_delete,
            monotonic_clock=lambda: 1_000.0,
        )
        await pool.start()
        first = await pool.acquire()
        self.assertIsNotNone(first)
        assert first is not None
        self.assertEqual(first.url, f"https://example.daily.co/{first.name}")

        for _ in range(50):
            if pool.size >= 1:
                break
            await asyncio.sleep(0)
        self.assertGreaterEqual(len(created_names), 2)
        await pool.stop()

    async def test_acquire_discards_soon_to_expire_rooms(self) -> None:
        deleted: list[str] = []
        now = 1_000.0

        async def fake_create(*, name: str, exp_at: float) -> str:
            return f"https://example.daily.co/{name}"

        async def fake_delete(name: str) -> None:
            deleted.append(name)

        pool = DailyRoomPool(
            api_key="daily-key",
            pool_size=1,
            room_ttl_hours=1.0,
            min_remaining_secs=300,
            create_room=fake_create,
            delete_room=fake_delete,
            monotonic_clock=lambda: now,
        )
        await pool._available.put(
            PooledDailyRoom(
                name="sleek-old",
                url="https://example.daily.co/sleek-old",
                exp_at=now + 30,
            )
        )
        room = await pool.acquire()
        self.assertIsNone(room)
        self.assertEqual(deleted, ["sleek-old"])
        await pool.stop()


if __name__ == "__main__":
    unittest.main()
