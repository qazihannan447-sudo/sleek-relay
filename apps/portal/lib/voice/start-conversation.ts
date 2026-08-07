import type { SupabaseClient } from '@supabase/supabase-js';

import { isConversationUuid } from '../conversations/helpers';
import {
  loadWorkspaceContext,
  type WorkspaceContext,
} from '../dashboard/load-workspace-context';
import {
  createServerSupabaseAdminClient,
  getSupabaseAdminEnv,
} from '../supabase/admin';
import { createServerSupabaseClient } from '../supabase/server';

export const browserConversationSource = 'browser_test' as const;

export type BrowserConversationSource = typeof browserConversationSource;

export type StartConversationRequestBody = {
  agentId: string;
  source: BrowserConversationSource;
};

export type StartConversationSuccessBody = {
  conversationId: string;
  startedAt: string;
  status: 'starting';
};

export type StartConversationErrorBody = {
  error: string;
};

export type StartConversationApiResult = {
  body: StartConversationErrorBody | StartConversationSuccessBody;
  status: number;
};

type StartConversationAgentRow = {
  id: string;
  status: 'active' | 'draft' | 'paused';
};

type StartConversationInsertRow = {
  id: string;
  started_at: string;
  status: 'starting';
};

type StartConversationDeps = {
  createServerSupabaseAdminClient: typeof createServerSupabaseAdminClient;
  createServerSupabaseClient: typeof createServerSupabaseClient;
  getSupabaseAdminEnv: typeof getSupabaseAdminEnv;
  loadWorkspaceContext: typeof loadWorkspaceContext;
  now: () => Date;
};

type ParsedStartConversationRequest =
  | {
      data: StartConversationRequestBody;
      ok: true;
    }
  | {
      body: StartConversationErrorBody;
      ok: false;
      status: number;
    };

function buildErrorResult(
  status: number,
  error: string,
): StartConversationApiResult {
  return {
    body: {
      error,
    },
    status,
  };
}

function buildFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Unable to start the conversation right now.';
}

function getEnvironmentLabel(): string {
  return process.env.NODE_ENV === 'production' ? 'production' : 'local';
}

export async function parseStartConversationJsonRequest(
  request: Request,
): Promise<ParsedStartConversationRequest> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return {
      body: {
        error: 'Invalid JSON request body.',
      },
      ok: false,
      status: 400,
    };
  }

  return parseStartConversationRequestBody(body);
}

export function parseStartConversationRequestBody(
  value: unknown,
): ParsedStartConversationRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      body: {
        error: 'Request body must be a JSON object.',
      },
      ok: false,
      status: 400,
    };
  }

  const body = value as Record<string, unknown>;
  const agentId = body.agentId;
  const source = body.source;

  if (typeof agentId !== 'string' || !isConversationUuid(agentId)) {
    return {
      body: {
        error: 'Agent ID must be a valid UUID.',
      },
      ok: false,
      status: 400,
    };
  }

  if (source !== browserConversationSource) {
    return {
      body: {
        error: 'Source must be browser_test.',
      },
      ok: false,
      status: 400,
    };
  }

  return {
    data: {
      agentId,
      source,
    },
    ok: true,
  };
}

export function buildStartConversationInsert(args: {
  agentId: string;
  now: Date;
  tenantId: string;
}): {
  agent_id: string;
  latency_metrics: Record<string, never>;
  metadata: {
    client_type: 'portal';
    environment: string;
    transport: 'smallwebrtc';
  };
  runtime_snapshot: Record<string, never>;
  source: BrowserConversationSource;
  started_at: string;
  status: 'starting';
  tenant_id: string;
} {
  return {
    agent_id: args.agentId,
    latency_metrics: {},
    metadata: {
      client_type: 'portal',
      environment: getEnvironmentLabel(),
      transport: 'smallwebrtc',
    },
    runtime_snapshot: {},
    source: browserConversationSource,
    started_at: args.now.toISOString(),
    status: 'starting',
    tenant_id: args.tenantId,
  };
}

export function mapStartConversationSuccess(
  record: StartConversationInsertRow,
): StartConversationSuccessBody {
  return {
    conversationId: record.id,
    startedAt: record.started_at,
    status: record.status,
  };
}

function getWorkspaceErrorResult(
  workspace: Extract<WorkspaceContext, { kind: 'error' }>,
): StartConversationApiResult {
  return buildErrorResult(500, workspace.message);
}

async function resolveAuthorizedStartConversationAgent(args: {
  agentId: string;
  supabase: SupabaseClient;
  workspace: Extract<WorkspaceContext, { kind: 'authenticated' }>;
}): Promise<StartConversationAgentRow | null> {
  const { data, error } = await args.supabase
    .from('agents')
    .select('id, status')
    .eq('tenant_id', args.workspace.tenantId)
    .eq('id', args.agentId)
    .maybeSingle();

  if (error) {
    throw new Error('Unable to verify the selected agent.');
  }

  const agent = (data as StartConversationAgentRow | null) ?? null;

  if (!agent || agent.status !== 'active') {
    return null;
  }

  return agent;
}

export function createStartConversationService(deps: StartConversationDeps) {
  return async function startConversation(
    body: StartConversationRequestBody,
  ): Promise<StartConversationApiResult> {
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
      const agent = await resolveAuthorizedStartConversationAgent({
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

      return {
        body: mapStartConversationSuccess(data as StartConversationInsertRow),
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

      if (message === 'Unable to verify the selected agent.') {
        return buildErrorResult(500, message);
      }

      return buildErrorResult(
        500,
        'Unable to start the conversation right now.',
      );
    }
  };
}

export const startConversation = createStartConversationService({
  createServerSupabaseAdminClient,
  createServerSupabaseClient,
  getSupabaseAdminEnv,
  loadWorkspaceContext,
  now: () => new Date(),
});
