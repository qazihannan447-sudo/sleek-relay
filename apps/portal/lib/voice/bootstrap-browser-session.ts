import type { SupabaseClient } from '@supabase/supabase-js';

import {
  type BuildAgentRuntimePackageForTenantResult,
  buildAgentRuntimePackageForTenant,
} from '../runtime/builder';
import {
  loadWorkspaceContext,
  type WorkspaceContext,
} from '../dashboard/load-workspace-context';
import {
  createServerSupabaseAdminClient,
  getSupabaseAdminEnv,
} from '../supabase/admin';
import { createServerSupabaseClient } from '../supabase/server';
import { isConversationUuid } from '../conversations/helpers';
import { signVoiceSessionToken } from './session-token';
import {
  buildStartConversationInsert,
  type StartConversationRequestBody,
} from './start-conversation';

export type BootstrapBrowserVoiceSessionSuccessBody = {
  conversationId: string;
  expiresAt: string;
  runtimePackage: Extract<
    BuildAgentRuntimePackageForTenantResult,
    { ok: true }
  >['runtimePackage'];
  startedAt: string;
  status: 'starting';
  token: string;
  tokenType: 'Bearer';
};

export type BootstrapBrowserVoiceSessionErrorBody = {
  error: string;
};

export type BootstrapBrowserVoiceSessionResult = {
  body:
    | BootstrapBrowserVoiceSessionErrorBody
    | BootstrapBrowserVoiceSessionSuccessBody;
  headers: Record<string, string>;
  status: number;
};

type BootstrapBrowserVoiceSessionDeps = {
  buildAgentRuntimePackageForTenant: typeof buildAgentRuntimePackageForTenant;
  createServerSupabaseAdminClient: typeof createServerSupabaseAdminClient;
  createServerSupabaseClient: typeof createServerSupabaseClient;
  getSupabaseAdminEnv: typeof getSupabaseAdminEnv;
  loadWorkspaceContext: typeof loadWorkspaceContext;
  now: () => Date;
  signVoiceSessionToken: typeof signVoiceSessionToken;
};

type ActiveAgentRow = {
  id: string;
  status: 'active' | 'draft' | 'paused';
};

type ConversationInsertRow = {
  id: string;
  started_at: string;
  status: 'starting';
};

const bootstrapHeaders = {
  'Cache-Control': 'no-store, max-age=0',
  Pragma: 'no-cache',
} as const;

function buildErrorResult(
  status: number,
  error: string,
): BootstrapBrowserVoiceSessionResult {
  return {
    body: { error },
    headers: { ...bootstrapHeaders },
    status,
  };
}

function buildFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Unable to bootstrap the browser voice session right now.';
}

function getWorkspaceErrorResult(
  workspace: Extract<WorkspaceContext, { kind: 'error' }>,
): BootstrapBrowserVoiceSessionResult {
  return buildErrorResult(500, workspace.message);
}

async function resolveActiveTenantAgent(args: {
  agentId: string;
  supabase: SupabaseClient;
  workspace: Extract<WorkspaceContext, { kind: 'authenticated' }>;
}): Promise<ActiveAgentRow | null> {
  const { data, error } = await args.supabase
    .from('agents')
    .select('id, status')
    .eq('tenant_id', args.workspace.tenantId)
    .eq('id', args.agentId)
    .maybeSingle();

  if (error) {
    throw new Error('Unable to verify the selected agent.');
  }

  const agent = (data as ActiveAgentRow | null) ?? null;

  if (!agent || agent.status !== 'active') {
    return null;
  }

  return agent;
}

export function createBootstrapBrowserVoiceSessionService(
  deps: BootstrapBrowserVoiceSessionDeps,
) {
  return async function bootstrapBrowserVoiceSession(
    body: StartConversationRequestBody,
  ): Promise<BootstrapBrowserVoiceSessionResult> {
    if (!isConversationUuid(body.agentId)) {
      return buildErrorResult(400, 'Agent ID must be a valid UUID.');
    }

    try {
      const workspace = await deps.loadWorkspaceContext();

      if (workspace.kind === 'unauthenticated') {
        return buildErrorResult(401, 'Your session is not authenticated.');
      }

      if (workspace.kind === 'missing-membership') {
        return buildErrorResult(
          403,
          'A tenant workspace is required before starting a conversation.',
        );
      }

      if (workspace.kind === 'error') {
        return getWorkspaceErrorResult(workspace);
      }

      const supabase = await deps.createServerSupabaseClient();
      const agent = await resolveActiveTenantAgent({
        agentId: body.agentId,
        supabase,
        workspace,
      });

      if (!agent) {
        return buildErrorResult(404, 'The requested agent is unavailable.');
      }

      deps.getSupabaseAdminEnv();
      const adminSupabase = await deps.createServerSupabaseAdminClient();
      const insert = buildStartConversationInsert({
        agentId: agent.id,
        now: deps.now(),
        tenantId: workspace.tenantId,
      });

      const { data, error } = await adminSupabase
        .from('conversations')
        .insert(insert)
        .select('id, status, started_at')
        .single();

      if (error || !data) {
        return buildErrorResult(
          500,
          'Unable to start the conversation right now.',
        );
      }

      const conversation = data as ConversationInsertRow;
      const [signedToken, runtimePackage] = await Promise.all([
        deps.signVoiceSessionToken({
          agentId: agent.id,
          conversationId: conversation.id,
          now: deps.now(),
        }),
        deps.buildAgentRuntimePackageForTenant({
          agentId: agent.id,
          supabase: adminSupabase,
          tenantId: workspace.tenantId,
          tenantName: workspace.tenantName,
          tenantSlug: workspace.tenantSlug,
        }),
      ]);

      if (!runtimePackage.ok) {
        return buildErrorResult(
          500,
          'Unable to build the runtime configuration right now.',
        );
      }

      return {
        body: {
          conversationId: conversation.id,
          expiresAt: signedToken.expiresAt,
          runtimePackage: runtimePackage.runtimePackage,
          startedAt: conversation.started_at,
          status: 'starting',
          token: signedToken.token,
          tokenType: 'Bearer',
        },
        headers: { ...bootstrapHeaders },
        status: 201,
      };
    } catch (error) {
      const message = buildFailureMessage(error);

      if (message.includes('SUPABASE_SERVICE_ROLE_KEY')) {
        return buildErrorResult(
          500,
          'Server configuration for conversation writes is unavailable.',
        );
      }

      if (message.includes('VOICE_SESSION_SIGNING_SECRET')) {
        return buildErrorResult(
          500,
          'Server configuration for voice session tokens is unavailable.',
        );
      }

      if (message === 'Unable to verify the selected agent.') {
        return buildErrorResult(500, message);
      }

      return buildErrorResult(
        500,
        'Unable to bootstrap the browser voice session right now.',
      );
    }
  };
}

export const bootstrapBrowserVoiceSession =
  createBootstrapBrowserVoiceSessionService({
    buildAgentRuntimePackageForTenant,
    createServerSupabaseAdminClient,
    createServerSupabaseClient,
    getSupabaseAdminEnv,
    loadWorkspaceContext,
    now: () => new Date(),
    signVoiceSessionToken,
  });
