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
CONVERSATIONS_MIGRATION_PATH = (
    ROOT
    / "supabase"
    / "migrations"
    / "20260806203226_add_tenant_scoped_conversations_foundation.sql"
)
CAPTURE_HANDOFF_MIGRATION_PATH = (
    ROOT
    / "supabase"
    / "migrations"
    / "20260808090000_add_capture_handoff_configuration.sql"
)
NOTIFICATIONS_MIGRATION_PATH = (
    ROOT
    / "supabase"
    / "migrations"
    / "20260808160000_add_conversation_notifications.sql"
)
USAGE_METRICS_MIGRATION_PATH = (
    ROOT
    / "supabase"
    / "migrations"
    / "20260808170000_add_conversation_usage_metrics.sql"
)
NOTIFICATIONS_INBOX_MIGRATION_PATH = (
    ROOT
    / "supabase"
    / "migrations"
    / "20260808180000_notifications_inbox_only.sql"
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
        cls.conversations_migration_sql = CONVERSATIONS_MIGRATION_PATH.read_text(
            encoding="utf-8"
        )
        cls.capture_handoff_migration_sql = CAPTURE_HANDOFF_MIGRATION_PATH.read_text(
            encoding="utf-8"
        )
        cls.notifications_migration_sql = NOTIFICATIONS_MIGRATION_PATH.read_text(
            encoding="utf-8"
        )
        cls.usage_metrics_migration_sql = USAGE_METRICS_MIGRATION_PATH.read_text(
            encoding="utf-8"
        )
        cls.notifications_inbox_migration_sql = (
            NOTIFICATIONS_INBOX_MIGRATION_PATH.read_text(encoding="utf-8")
        )
        cls.seed_sql = SEED_PATH.read_text(encoding="utf-8")
        cls.pgtap_sql = PGTAP_PATH.read_text(encoding="utf-8")
        cls.combined_schema_sql = "\n".join(
            (
                cls.migration_sql,
                cls.agent_settings_migration_sql,
                cls.knowledge_migration_sql,
                cls.conversations_migration_sql,
                cls.capture_handoff_migration_sql,
                cls.notifications_migration_sql,
                cls.usage_metrics_migration_sql,
                cls.notifications_inbox_migration_sql,
            )
        )

    def test_schema_scope_includes_conversation_foundation(self) -> None:
        for table_name in (
            "public.user_profiles",
            "public.tenants",
            "public.tenant_memberships",
            "public.business_configurations",
            "public.agents",
            "public.business_knowledge",
            "public.conversations",
            "public.conversation_messages",
            "public.conversation_captures",
        ):
            self.assertIn(f"create table {table_name}", self.combined_schema_sql)

        for unexpected in ("session", "recording", "provider", "tool"):
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
        self.assertIn("member can read own tenant conversations", self.pgtap_sql)
        self.assertIn(
            "member cannot read tenant B conversation messages", self.pgtap_sql
        )
        self.assertIn("agent tenant must match conversation tenant", self.pgtap_sql)
        self.assertIn(
            "duplicate message sequence numbers are rejected", self.pgtap_sql
        )

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

    def test_conversations_migration_creates_tenant_scoped_tables_and_rls(self) -> None:
        for fragment in (
            "alter table public.agents",
            "create table public.conversations",
            "status in ('starting', 'active', 'completed', 'failed', 'cancelled')",
            "duration_ms is null or duration_ms >= 0",
            "ended_at is null or ended_at >= started_at",
            "foreign key (tenant_id, agent_id) references public.agents(tenant_id, id)",
            "create trigger set_conversations_updated_at",
            "create table public.conversation_messages",
            "role in ('user', 'assistant', 'system', 'tool')",
            "sequence_number > 0",
            "btrim(content) <> ''",
            "foreign key (tenant_id, conversation_id)",
            "on delete cascade",
            "grant select on public.conversations to authenticated;",
            "grant select on public.conversation_messages to authenticated;",
            "grant all privileges on public.conversations to service_role;",
            "grant all privileges on public.conversation_messages to service_role;",
            'create policy "conversations_select_for_members"',
            'create policy "conversation_messages_select_for_members"',
        ):
            self.assertIn(fragment, self.conversations_migration_sql)

    def test_capture_handoff_migration_adds_config_and_capture_table(self) -> None:
        for fragment in (
            "add column appointment_policy text",
            "handoff_destination_type",
            "handoff_destination_value",
            "handoff_script",
            "notification_email",
            "add column capabilities jsonb",
            "create table public.conversation_captures",
            "capture_type in (",
            "'appointment_request'",
            "'handoff_request'",
            "status in ('captured', 'requested')",
            "grant select on public.conversation_captures to authenticated;",
            "grant all privileges on public.conversation_captures to service_role;",
            'create policy "conversation_captures_select_for_members"',
        ):
            self.assertIn(fragment, self.capture_handoff_migration_sql)

    def test_notifications_migration_adds_table_and_whatsapp_destination(self) -> None:
        for fragment in (
            "add column notification_whatsapp text",
            "create table public.conversation_notifications",
            "kind in ('close_off')",
            "channel in ('whatsapp', 'email')",
            "status in ('sent', 'failed', 'logged')",
            "grant select on public.conversation_notifications to authenticated;",
            "grant all privileges on public.conversation_notifications to service_role;",
            'create policy "conversation_notifications_select_for_members"',
        ):
            self.assertIn(fragment, self.notifications_migration_sql)

    def test_notifications_inbox_migration_adds_inbox_channel(self) -> None:
        for fragment in (
            "channel in ('inbox', 'whatsapp', 'email')",
            "alter column destination drop not null",
            "channel = 'inbox'",
            "destination = 'Business inbox'",
        ):
            self.assertIn(fragment, self.notifications_inbox_migration_sql)

    def test_usage_metrics_migration_adds_conversation_column(self) -> None:
        for fragment in (
            "add column if not exists usage_metrics jsonb not null default '{}'::jsonb",
            "conversations.usage_metrics",
        ):
            self.assertIn(fragment, self.usage_metrics_migration_sql)

    def test_seed_includes_realistic_conversations_and_messages(self) -> None:
        for fragment in (
            "insert into public.conversations",
            "'completed'",
            "'failed'",
            '"stt_first_partial_ms":380',
            '"llm_first_token_ms":2100',
            '"total_tokens":2460',
            "usage_metrics = excluded.usage_metrics",
            "insert into public.conversation_messages",
            "false,\n    true,",
            "The assistant could not finish the response before the provider timeout window closed.",
            "appointment_policy = 'We accept appointment requests only",
            '"capture_appointments": true',
            '"capture_leads": true',
            '"capture_messages": true',
            '"offer_handoff": true',
            "handoff_destination_type = 'callback'",
        ):
            self.assertIn(fragment, self.seed_sql)


if __name__ == "__main__":
    unittest.main()
