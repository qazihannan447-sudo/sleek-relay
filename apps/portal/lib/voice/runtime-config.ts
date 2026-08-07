import type { SupabaseClient } from '@supabase/supabase-js';

import {
  type BuildAgentRuntimePackageForTenantResult,
  buildAgentRuntimePackageForTenant,
} from '../runtime/builder';
import {
  createServerSupabaseAdminClient,
  getSupabaseAdminEnv,
} from '../supabase/admin';
import {
  parseBearerAuthorizationHeader,
  verifyVoiceSessionToken,
} from './session-token';
import { browserConversationSource } from './start-conversation';

type RuntimeConfigConversationStatus =
  | 'starting'
  | 'active'
  | 'completed'
  | 'failed'
  | 'cancelled';

type RuntimeConfigConversationRow = {
  agent_id: string;
  id: string;
  source: string;
  status: RuntimeConfigConversationStatus;
  tenant_id: string;
};

type RuntimeConfigAgentRow = {
  id: string;
  tenant_id: string;
};

type RuntimeConfigTenantRow = {
  id: string;
  name: string;
  slug: string;
};

type RuntimeConfigSuccessBody = {
  conversationId: string;
  runtimePackage: Extract<
    BuildAgentRuntimePackageForTenantResult,
    { ok: true }
  >['runtimePackage'];
};

type RuntimeConfigErrorBody = {
  error: string;
};

export type IssueVoiceRuntimeConfigResult = {
  body: RuntimeConfigErrorBody | RuntimeConfigSuccessBody;
  headers: Record<string, string>;
  status: number;
};

type IssueVoiceRuntimeConfigDeps = {
  buildAgentRuntimePackageForTenant: typeof buildAgentRuntimePackageForTenant;
  createServerSupabaseAdminClient: typeof createServerSupabaseAdminClient;
  getSupabaseAdminEnv: typeof getSupabaseAdminEnv;
  verifyVoiceSessionToken: typeof verifyVoiceSessionToken;
};

const runtimeConfigHeaders = {
  'Cache-Control': 'no-store',
} as const;

function buildErrorResult(
  status: number,
  error: string,
): IssueVoiceRuntimeConfigResult {
  return {
    body: { error },
    headers: { ...runtimeConfigHeaders },
    status,
  };
}

function mapIssueVoiceRuntimeConfigSuccess(args: {
  conversationId: string;
  runtimePackage: RuntimeConfigSuccessBody['runtimePackage'];
}): IssueVoiceRuntimeConfigResult {
  return {
    body: {
      conversationId: args.conversationId,
      runtimePackage: args.runtimePackage,
    },
    headers: { ...runtimeConfigHeaders },
    status: 200,
  };
}

function canIssueVoiceRuntimeConfig(
  conversation: RuntimeConfigConversationRow,
): boolean {
  return (
    conversation.source === browserConversationSource &&
    (conversation.status === 'starting' || conversation.status === 'active')
  );
}

async function resolveConversation(args: {
  agentId: string;
  conversationId: string;
  supabase: SupabaseClient;
}): Promise<RuntimeConfigConversationRow | null> {
  const { data, error } = await args.supabase
    .from('conversations')
    .select('id, tenant_id, agent_id, source, status')
    .eq('id', args.conversationId)
    .eq('agent_id', args.agentId)
    .maybeSingle();

  if (error) {
    throw new Error('Unable to load the requested conversation.');
  }

  return (data as RuntimeConfigConversationRow | null) ?? null;
}

async function resolveAgent(args: {
  agentId: string;
  supabase: SupabaseClient;
  tenantId: string;
}): Promise<RuntimeConfigAgentRow | null> {
  const { data, error } = await args.supabase
    .from('agents')
    .select('id, tenant_id')
    .eq('id', args.agentId)
    .eq('tenant_id', args.tenantId)
    .maybeSingle();

  if (error) {
    throw new Error('Unable to verify the selected agent.');
  }

  return (data as RuntimeConfigAgentRow | null) ?? null;
}

async function resolveTenant(args: {
  supabase: SupabaseClient;
  tenantId: string;
}): Promise<RuntimeConfigTenantRow | null> {
  const { data, error } = await args.supabase
    .from('tenants')
    .select('id, name, slug')
    .eq('id', args.tenantId)
    .maybeSingle();

  if (error) {
    throw new Error('Unable to verify the tenant workspace.');
  }

  return (data as RuntimeConfigTenantRow | null) ?? null;
}

function isServerConfigurationError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes('VOICE_SESSION_SIGNING_SECRET') ||
    error.message.includes('SUPABASE_SERVICE_ROLE_KEY')
  );
}

export function createIssueVoiceRuntimeConfigService(
  deps: IssueVoiceRuntimeConfigDeps,
) {
  return async function issueVoiceRuntimeConfig(
    authorizationHeader: string | null,
  ): Promise<IssueVoiceRuntimeConfigResult> {
    const authorization = parseBearerAuthorizationHeader(authorizationHeader);

    if (!authorization.ok) {
      return buildErrorResult(401, authorization.error);
    }

    try {
      const verified = await deps.verifyVoiceSessionToken(authorization.token);

      if (!verified.ok) {
        return buildErrorResult(401, verified.error);
      }

      deps.getSupabaseAdminEnv();

      const supabase = await deps.createServerSupabaseAdminClient();
      const conversation = await resolveConversation({
        agentId: verified.claims.agentId,
        conversationId: verified.claims.conversationId,
        supabase,
      });

      if (!conversation) {
        return buildErrorResult(
          404,
          'The requested conversation is unavailable.',
        );
      }

      if (!canIssueVoiceRuntimeConfig(conversation)) {
        return buildErrorResult(
          409,
          'The requested conversation is not eligible for runtime configuration.',
        );
      }

      const agent = await resolveAgent({
        agentId: verified.claims.agentId,
        supabase,
        tenantId: conversation.tenant_id,
      });

      if (!agent || agent.id !== conversation.agent_id) {
        return buildErrorResult(
          404,
          'The requested conversation is unavailable.',
        );
      }

      const tenant = await resolveTenant({
        supabase,
        tenantId: conversation.tenant_id,
      });

      if (!tenant || tenant.id !== agent.tenant_id) {
        return buildErrorResult(
          404,
          'The requested conversation is unavailable.',
        );
      }

      const runtimePackage = await deps.buildAgentRuntimePackageForTenant({
        agentId: agent.id,
        supabase,
        tenantId: tenant.id,
        tenantName: tenant.name,
        tenantSlug: tenant.slug,
      });

      if (!runtimePackage.ok) {
        return buildErrorResult(
          500,
          'Unable to build the runtime configuration right now.',
        );
      }

      return mapIssueVoiceRuntimeConfigSuccess({
        conversationId: conversation.id,
        runtimePackage: runtimePackage.runtimePackage,
      });
    } catch (error) {
      if (isServerConfigurationError(error)) {
        return buildErrorResult(
          500,
          'Server configuration for voice runtime configuration is unavailable.',
        );
      }

      return buildErrorResult(
        500,
        'Unable to build the runtime configuration right now.',
      );
    }
  };
}

export function createIssueVoiceRuntimeConfigRouteHandler(
  handler: (
    _authorizationHeader: string | null,
  ) => Promise<IssueVoiceRuntimeConfigResult>,
) {
  return async function POST(request: Request) {
    const result = await handler(request.headers.get('authorization'));

    return Response.json(result.body, {
      headers: result.headers,
      status: result.status,
    });
  };
}

export const issueVoiceRuntimeConfig = createIssueVoiceRuntimeConfigService({
  buildAgentRuntimePackageForTenant,
  createServerSupabaseAdminClient,
  getSupabaseAdminEnv,
  verifyVoiceSessionToken,
});
