import type { SupabaseClient } from '@supabase/supabase-js';

import { isConversationUuid } from '../conversations/helpers';
import {
  loadWorkspaceContext,
  type WorkspaceContext,
} from '../dashboard/load-workspace-context';
import { createServerSupabaseClient } from '../supabase/server';
import {
  signVoiceSessionToken,
} from './session-token';
import { browserConversationSource } from './start-conversation';

type VoiceSessionConversationStatus =
  | 'starting'
  | 'active'
  | 'completed'
  | 'failed'
  | 'cancelled';

type VoiceSessionTokenConversationRow = {
  agent_id: string;
  id: string;
  source: string;
  status: VoiceSessionConversationStatus;
  tenant_id: string;
};

type VoiceSessionTokenAgentRow = {
  id: string;
};

type IssueVoiceSessionTokenSuccessBody = {
  conversationId: string;
  expiresAt: string;
  token: string;
  tokenType: 'Bearer';
};

type IssueVoiceSessionTokenErrorBody = {
  error: string;
};

export type IssueVoiceSessionTokenResult = {
  body: IssueVoiceSessionTokenErrorBody | IssueVoiceSessionTokenSuccessBody;
  headers?: Record<string, string>;
  status: number;
};

type IssueVoiceSessionTokenDeps = {
  createServerSupabaseClient: typeof createServerSupabaseClient;
  loadWorkspaceContext: typeof loadWorkspaceContext;
  now: () => Date;
  signVoiceSessionToken: typeof signVoiceSessionToken;
};

const voiceSessionTokenSuccessHeaders = {
  'Cache-Control': 'no-store, max-age=0',
  Pragma: 'no-cache',
} as const;

function buildErrorResult(
  status: number,
  error: string,
): IssueVoiceSessionTokenResult {
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

  return 'Unable to issue a voice session token right now.';
}

function getWorkspaceErrorResult(
  workspace: Extract<WorkspaceContext, { kind: 'error' }>,
): IssueVoiceSessionTokenResult {
  return buildErrorResult(500, workspace.message);
}

function canIssueVoiceSessionToken(
  conversation: VoiceSessionTokenConversationRow,
): boolean {
  return (
    conversation.source === browserConversationSource &&
    (conversation.status === 'starting' || conversation.status === 'active')
  );
}

async function resolveAuthorizedConversationForVoiceSessionToken(args: {
  conversationId: string;
  supabase: SupabaseClient;
  workspace: Extract<WorkspaceContext, { kind: 'authenticated' }>;
}): Promise<VoiceSessionTokenConversationRow | null> {
  const { data, error } = await args.supabase
    .from('conversations')
    .select('id, tenant_id, agent_id, source, status')
    .eq('tenant_id', args.workspace.tenantId)
    .eq('id', args.conversationId)
    .maybeSingle();

  if (error) {
    throw new Error('Unable to verify the requested conversation.');
  }

  return (data as VoiceSessionTokenConversationRow | null) ?? null;
}

async function resolveTenantAgentForVoiceSessionToken(args: {
  agentId: string;
  supabase: SupabaseClient;
  workspace: Extract<WorkspaceContext, { kind: 'authenticated' }>;
}): Promise<VoiceSessionTokenAgentRow | null> {
  const { data, error } = await args.supabase
    .from('agents')
    .select('id')
    .eq('tenant_id', args.workspace.tenantId)
    .eq('id', args.agentId)
    .maybeSingle();

  if (error) {
    throw new Error('Unable to verify the selected agent.');
  }

  return (data as VoiceSessionTokenAgentRow | null) ?? null;
}

export function mapIssueVoiceSessionTokenSuccess(args: {
  conversationId: string;
  expiresAt: string;
  token: string;
}): IssueVoiceSessionTokenResult {
  return {
    body: {
      conversationId: args.conversationId,
      expiresAt: args.expiresAt,
      token: args.token,
      tokenType: 'Bearer',
    },
    headers: { ...voiceSessionTokenSuccessHeaders },
    status: 200,
  };
}

export function createIssueVoiceSessionTokenService(
  deps: IssueVoiceSessionTokenDeps,
) {
  return async function issueVoiceSessionToken(
    conversationId: string,
  ): Promise<IssueVoiceSessionTokenResult> {
    if (!isConversationUuid(conversationId)) {
      return buildErrorResult(404, 'The requested conversation is unavailable.');
    }

    try {
      const workspace = await deps.loadWorkspaceContext();

      if (workspace.kind === 'unauthenticated') {
        return buildErrorResult(401, 'Your session is not authenticated.');
      }

      if (workspace.kind === 'missing-membership') {
        return buildErrorResult(
          403,
          'A tenant workspace is required before issuing a voice session token.',
        );
      }

      if (workspace.kind === 'error') {
        return getWorkspaceErrorResult(workspace);
      }

      const supabase = await deps.createServerSupabaseClient();
      const conversation =
        await resolveAuthorizedConversationForVoiceSessionToken({
          conversationId,
          supabase,
          workspace,
        });

      if (!conversation) {
        return buildErrorResult(
          404,
          'The requested conversation is unavailable.',
        );
      }

      if (!canIssueVoiceSessionToken(conversation)) {
        return buildErrorResult(
          409,
          'The requested conversation is not eligible for a voice session token.',
        );
      }

      const agent = await resolveTenantAgentForVoiceSessionToken({
        agentId: conversation.agent_id,
        supabase,
        workspace,
      });

      if (!agent) {
        return buildErrorResult(
          404,
          'The requested conversation is unavailable.',
        );
      }

      const signedToken = await deps.signVoiceSessionToken({
        agentId: agent.id,
        conversationId: conversation.id,
        now: deps.now(),
      });

      return mapIssueVoiceSessionTokenSuccess({
        conversationId: conversation.id,
        expiresAt: signedToken.expiresAt,
        token: signedToken.token,
      });
    } catch (error) {
      const message = buildFailureMessage(error);

      if (message.includes('VOICE_SESSION_SIGNING_SECRET')) {
        return buildErrorResult(
          500,
          'Server configuration for voice session tokens is unavailable.',
        );
      }

      if (
        message === 'Unable to verify the requested conversation.' ||
        message === 'Unable to verify the selected agent.'
      ) {
        return buildErrorResult(500, message);
      }

      return buildErrorResult(
        500,
        'Unable to issue a voice session token right now.',
      );
    }
  };
}

export const issueVoiceSessionToken = createIssueVoiceSessionTokenService({
  createServerSupabaseClient,
  loadWorkspaceContext,
  now: () => new Date(),
  signVoiceSessionToken,
});
