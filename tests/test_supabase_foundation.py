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
AGENT_SETTINGS_MIGRATION_PATH = (
    ROOT
    / "supabase"
    / "migrations"
    / "20260806083745_add_agent_runtime_settings.sql"
)
KNOWLEDGE_MIGRATION_PATH = (
    ROOT
    / "supabase"
    / "migrations"
    / "20260806090200_add_business_knowledge_and_runtime_support.sql"
)
WORKSPACE_BOOTSTRAP_MIGRATION_PATH = (
    ROOT
    / "supabase"
    / "migrations"
    / "20260806143000_add_initial_workspace_bootstrap.sql"
)
SEED_PATH = ROOT / "supabase" / "seed" / "demo_tenants.sql"
PGTAP_PATH = ROOT / "supabase" / "tests" / "database" / "foundation_rls.test.sql"


class SupabaseFoundationArtifactTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.migration_sql = MIGRATION_PATH.read_text(encoding="utf-8")
        cls.repair_migration_sql = REPAIR_MIGRATION_PATH.read_text(encoding="utf-8")
        cls.agent_settings_migration_sql = AGENT_SETTINGS_MIGRATION_PATH.read_text(
            encoding="utf-8"
        )
        cls.knowledge_migration_sql = KNOWLEDGE_MIGRATION_PATH.read_text(
            encoding="utf-8"
        )
        cls.workspace_bootstrap_migration_sql = (
            WORKSPACE_BOOTSTRAP_MIGRATION_PATH.read_text(encoding="utf-8")
        )
        cls.seed_sql = SEED_PATH.read_text(encoding="utf-8")
        cls.pgtap_sql = PGTAP_PATH.read_text(encoding="utf-8")
        cls.combined_schema_sql = "\n".join(
            (
                cls.migration_sql,
                cls.agent_settings_migration_sql,
                cls.knowledge_migration_sql,
            )
        )

    def test_schema_scope_stays_limited(self) -> None:
        for table_name in (
            "public.user_profiles",
            "public.tenants",
            "public.tenant_memberships",
            "public.business_configurations",
            "public.agents",
            "public.business_knowledge",
        ):
            self.assertIn(f"create table {table_name}", self.combined_schema_sql)

        for unexpected in ("conversation", "session", "recording", "provider", "tool"):
            self.assertNotIn(
                f"create table public.{unexpected}",
                self.combined_schema_sql,
            )

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
        self.assertIn("member can read own tenant knowledge", self.pgtap_sql)
        self.assertIn("admin can add business knowledge within own tenant", self.pgtap_sql)

    def test_repair_migration_revokes_public_rls_auto_enable_execution(self) -> None:
        for role_name in ("public", "anon", "authenticated"):
            self.assertIn(
                f"revoke execute on function public.rls_auto_enable() from {role_name};",
                self.repair_migration_sql,
            )

    def test_agent_settings_migration_is_focused_on_agents_table(self) -> None:
        self.assertIn("alter table public.agents", self.agent_settings_migration_sql)

        for column_name in (
            "voice_id",
            "tone",
            "special_instructions",
            "fallback_message",
            "interruption_enabled",
            "silence_timeout_seconds",
            "maximum_session_duration_seconds",
        ):
            self.assertIn(column_name, self.agent_settings_migration_sql)

        self.assertNotIn(
            "alter table public.business_configurations",
            self.agent_settings_migration_sql,
        )

    def test_knowledge_migration_creates_tenant_scoped_rls_table(self) -> None:
        self.assertIn(
            "create table public.business_knowledge",
            self.knowledge_migration_sql,
        )
        for fragment in (
            "kind in ('faq', 'policy', 'business_fact', 'service_information')",
            "status in ('draft', 'approved', 'disabled')",
            "alter table public.business_knowledge enable row level security;",
            'create policy "business_knowledge_select_for_members"',
            'create policy "business_knowledge_insert_for_managers"',
            'create policy "business_knowledge_update_for_managers"',
            'create policy "business_knowledge_delete_for_managers"',
        ):
            self.assertIn(fragment, self.knowledge_migration_sql)

    def test_workspace_bootstrap_migration_creates_guarded_setup_function(self) -> None:
        for fragment in (
            "create or replace function private.slugify_workspace_name",
            "create or replace function public.create_initial_workspace",
            "security definer",
            "raise exception 'workspace already exists for current user';",
            "insert into public.tenants",
            "insert into public.tenant_memberships",
            "insert into public.business_configurations",
            "grant execute on function public.create_initial_workspace(text, text, text, text) to authenticated;",
        ):
            self.assertIn(fragment, self.workspace_bootstrap_migration_sql)

        self.assertIn(
            "revoke all on function public.create_initial_workspace(text, text, text, text) from anon;",
            self.workspace_bootstrap_migration_sql,
        )


if __name__ == "__main__":
    unittest.main()
