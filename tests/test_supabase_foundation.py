from __future__ import annotations

import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
MIGRATION_PATH = ROOT / "supabase" / "migrations" / "20260805171847_initial_data_foundation.sql"
REPAIR_MIGRATION_PATH = (
    ROOT
    / "supabase"
    / "migrations"
    / "20260805193904_revoke_public_rls_auto_enable_execute.sql"
)
SEED_PATH = ROOT / "supabase" / "seed" / "demo_tenants.sql"
PGTAP_PATH = ROOT / "supabase" / "tests" / "database" / "foundation_rls.test.sql"


class SupabaseFoundationArtifactTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.migration_sql = MIGRATION_PATH.read_text(encoding="utf-8")
        cls.repair_migration_sql = REPAIR_MIGRATION_PATH.read_text(encoding="utf-8")
        cls.seed_sql = SEED_PATH.read_text(encoding="utf-8")
        cls.pgtap_sql = PGTAP_PATH.read_text(encoding="utf-8")

    def test_schema_scope_stays_limited(self) -> None:
        for table_name in (
            "public.user_profiles",
            "public.tenants",
            "public.tenant_memberships",
            "public.business_configurations",
            "public.agents",
        ):
            self.assertIn(f"create table {table_name}", self.migration_sql)

        for unexpected in ("conversation", "session", "recording", "provider", "tool"):
            self.assertNotIn(f"create table public.{unexpected}", self.migration_sql)

    def test_seed_depends_on_auth_users(self) -> None:
        self.assertIn("insert into auth.users", self.seed_sql)
        self.assertNotIn("insert into public.user_profiles", self.seed_sql)

    def test_database_rls_tests_exist(self) -> None:
        self.assertIn("select plan(", self.pgtap_sql)
        self.assertIn("\\ir ../../seed/demo_tenants.sql", self.pgtap_sql)
        self.assertNotIn(
            "\\ir ../../migrations/20260805171847_initial_data_foundation.sql",
            self.pgtap_sql,
        )

    def test_repair_migration_revokes_public_rls_auto_enable_execution(self) -> None:
        for role_name in ("public", "anon", "authenticated"):
            self.assertIn(
                f"revoke execute on function public.rls_auto_enable() from {role_name};",
                self.repair_migration_sql,
            )


if __name__ == "__main__":
    unittest.main()
