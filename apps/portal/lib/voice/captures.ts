import type { SupabaseClient } from '@supabase/supabase-js';

import {
  createServerSupabaseAdminClient,
  getSupabaseAdminEnv,
} from '../supabase/admin';
import {
  applyCapabilityFieldPolicy,
  capabilitiesFromUnknown,
  captureTypeForTool,
  buildHandoffSpeakAs,
  isCaptureToolAllowed,
  isHandoffDestinationConfigured,
  outcomeForCaptureType,
  parseCaptureToolArgs,
  parseCreateCaptureRequest,
  speakAsForCaptureType,
  statusForCaptureType,
  type CaptureStatus,
  type CaptureToolResult,
  type CaptureType,
  type CreateCaptureRequest,
} from './capture-schema';
import type { HandoffDestinationType } from '../business-configuration/schema';
import {
  parseBearerAuthorizationHeader,
  verifyVoiceSessionToken,
} from './session-token';
import { browserConversationSource } from './start-conversation';

type CaptureConversationStatus =
  | 'starting'
  | 'active'
  | 'completed'
  | 'failed'
  | 'cancelled';

type CaptureConversationRow = {
  agent_id: string;
  id: string;
  outcome: string | null;
  source: string;
  status: CaptureConversationStatus;
  tenant_id: string;
};

type CaptureAgentRow = {
  capabilities: unknown;
  id: string;
  tenant_id: string;
};

type CaptureBusinessRow = {
  handoff_destination_type: string | null;
  handoff_destination_value: string | null;
  handoff_script: string | null;
  tenant_id: string;
};

type CaptureRow = {
  capture_type: string;
  id: string;
  status: string;
};

type CaptureSuccessBody = {
  result: Extract<CaptureToolResult, { ok: true }>;
};

type CaptureErrorBody = {
  error: string;
  result?: Extract<CaptureToolResult, { ok: false }>;
};

export type CreateConversationCaptureResult = {
  body: CaptureErrorBody | CaptureSuccessBody;
  headers: Record<string, string>;
  status: number;
};

type CreateConversationCaptureDeps = {
  createServerSupabaseAdminClient: typeof createServerSupabaseAdminClient;
  getSupabaseAdminEnv: typeof getSupabaseAdminEnv;
  verifyVoiceSessionToken: typeof verifyVoiceSessionToken;
};

const captureHeaders = {
  'Cache-Control': 'no-store',
} as const;

function buildErrorResult(
  status: number,
  error: string,
  result?: Extract<CaptureToolResult, { ok: false }>,
): CreateConversationCaptureResult {
  return {
    body: result ? { error, result } : { error },
    headers: { ...captureHeaders },
    status,
  };
}

function buildSuccessResult(
  result: Extract<CaptureToolResult, { ok: true }>,
): CreateConversationCaptureResult {
  return {
    body: { result },
    headers: { ...captureHeaders },
    status: 200,
  };
}

function canCaptureForConversation(conversation: CaptureConversationRow): boolean {
  return (
    conversation.source === browserConversationSource &&
    (conversation.status === 'starting' || conversation.status === 'active')
  );
}

function isUniqueViolation(error: { code?: string; message?: string } | null): boolean {
  if (!error) {
    return false;
  }
  return (
    error.code === '23505' ||
    Boolean(error.message?.toLowerCase().includes('duplicate'))
  );
}

async function resolveConversation(args: {
  agentId: string;
  conversationId: string;
  supabase: SupabaseClient;
}): Promise<CaptureConversationRow | null> {
  const { data, error } = await args.supabase
    .from('conversations')
    .select('id, tenant_id, agent_id, source, status, outcome')
    .eq('id', args.conversationId)
    .eq('agent_id', args.agentId)
    .maybeSingle();

  if (error) {
    throw new Error('Unable to load the requested conversation.');
  }

  return (data as CaptureConversationRow | null) ?? null;
}

async function resolveAgent(args: {
  agentId: string;
  supabase: SupabaseClient;
  tenantId: string;
}): Promise<CaptureAgentRow | null> {
  const { data, error } = await args.supabase
    .from('agents')
    .select('id, tenant_id, capabilities')
    .eq('id', args.agentId)
    .eq('tenant_id', args.tenantId)
    .maybeSingle();

  if (error) {
    throw new Error('Unable to verify the selected agent.');
  }

  return (data as CaptureAgentRow | null) ?? null;
}

async function resolveBusinessConfiguration(args: {
  supabase: SupabaseClient;
  tenantId: string;
}): Promise<CaptureBusinessRow | null> {
  const { data, error } = await args.supabase
    .from('business_configurations')
    .select(
      'tenant_id, handoff_destination_type, handoff_destination_value, handoff_script',
    )
    .eq('tenant_id', args.tenantId)
    .maybeSingle();

  if (error) {
    throw new Error('Unable to load business handoff settings.');
  }

  return (data as CaptureBusinessRow | null) ?? null;
}

function normalizeHandoffDestinationType(
  value: string | null | undefined,
): HandoffDestinationType {
  if (
    value === 'callback' ||
    value === 'phone_info' ||
    value === 'email_info' ||
    value === 'none'
  ) {
    return value;
  }
  return 'none';
}

async function loadExistingCapture(args: {
  conversationId: string;
  idempotencyKey: string;
  supabase: SupabaseClient;
  tenantId: string;
}): Promise<CaptureRow | null> {
  const { data, error } = await args.supabase
    .from('conversation_captures')
    .select('id, capture_type, status')
    .eq('tenant_id', args.tenantId)
    .eq('conversation_id', args.conversationId)
    .eq('idempotency_key', args.idempotencyKey)
    .maybeSingle();

  if (error) {
    throw new Error('Unable to load an existing capture.');
  }

  return (data as CaptureRow | null) ?? null;
}

async function insertCapture(args: {
  agentId: string;
  captureType: CaptureType;
  conversationId: string;
  idempotencyKey: string | null;
  payload: Record<string, unknown>;
  status: CaptureStatus;
  supabase: SupabaseClient;
  tenantId: string;
}): Promise<CaptureRow> {
  const { data, error } = await args.supabase
    .from('conversation_captures')
    .insert({
      agent_id: args.agentId,
      capture_type: args.captureType,
      conversation_id: args.conversationId,
      idempotency_key: args.idempotencyKey,
      payload: args.payload,
      status: args.status,
      tenant_id: args.tenantId,
    })
    .select('id, capture_type, status')
    .single();

  if (error) {
    if (args.idempotencyKey && isUniqueViolation(error)) {
      const existing = await loadExistingCapture({
        conversationId: args.conversationId,
        idempotencyKey: args.idempotencyKey,
        supabase: args.supabase,
        tenantId: args.tenantId,
      });
      if (existing) {
        return existing;
      }
    }
    throw new Error(error.message || 'Unable to persist the capture.');
  }

  return data as CaptureRow;
}

async function updateConversationOutcome(args: {
  conversationId: string;
  outcome: string;
  supabase: SupabaseClient;
  tenantId: string;
}): Promise<void> {
  const { error } = await args.supabase
    .from('conversations')
    .update({ outcome: args.outcome })
    .eq('tenant_id', args.tenantId)
    .eq('id', args.conversationId);

  if (error) {
    throw new Error('Unable to update the conversation outcome.');
  }
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

export function createConversationCaptureService(
  deps: CreateConversationCaptureDeps,
) {
  return async function createConversationCapture(args: {
    authorizationHeader: string | null;
    body: unknown;
    conversationId: string;
  }): Promise<CreateConversationCaptureResult> {
    const authorization = parseBearerAuthorizationHeader(args.authorizationHeader);

    if (!authorization.ok) {
      return buildErrorResult(401, authorization.error);
    }

    const parsedRequest = parseCreateCaptureRequest(args.body);
    if (!parsedRequest.ok) {
      return buildErrorResult(400, parsedRequest.message, {
        error: 'validation_failed',
        message: parsedRequest.message,
        ok: false,
      });
    }

    const request: CreateCaptureRequest = parsedRequest.value;

    try {
      const verified = await deps.verifyVoiceSessionToken(authorization.token);

      if (!verified.ok) {
        return buildErrorResult(401, verified.error);
      }

      if (verified.claims.conversationId !== args.conversationId) {
        return buildErrorResult(
          404,
          'The requested conversation is unavailable.',
        );
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

      if (!canCaptureForConversation(conversation)) {
        return buildErrorResult(
          409,
          'The requested conversation is not eligible for captures.',
        );
      }

      const agent = await resolveAgent({
        agentId: verified.claims.agentId,
        supabase,
        tenantId: conversation.tenant_id,
      });

      if (!agent) {
        return buildErrorResult(
          404,
          'The requested conversation is unavailable.',
        );
      }

      const capabilities = capabilitiesFromUnknown(agent.capabilities);
      if (!isCaptureToolAllowed(request.tool, capabilities)) {
        return buildErrorResult(
          403,
          'This capture tool is not enabled for the selected agent.',
          {
            error: 'not_allowed',
            message: 'This capture tool is not enabled for the selected agent.',
            ok: false,
          },
        );
      }

      let business: CaptureBusinessRow | null = null;
      if (request.tool === 'offer_human_handoff') {
        business = await resolveBusinessConfiguration({
          supabase,
          tenantId: conversation.tenant_id,
        });
        const destinationType = normalizeHandoffDestinationType(
          business?.handoff_destination_type,
        );
        if (!isHandoffDestinationConfigured(destinationType)) {
          return buildErrorResult(
            403,
            'No business handoff destination is configured.',
            {
              error: 'not_allowed',
              message:
                'No business handoff destination is configured. Use the fallback message instead of inventing a transfer.',
              ok: false,
            },
          );
        }
      }

      const parsedArgs = parseCaptureToolArgs(request.tool, request.args);
      if (!parsedArgs.ok) {
        return buildErrorResult(400, parsedArgs.message, {
          error: 'validation_failed',
          message: parsedArgs.message,
          ok: false,
        });
      }

      const fieldPolicy = applyCapabilityFieldPolicy(
        request.tool,
        parsedArgs.payload,
        capabilities,
      );
      if (!fieldPolicy.ok) {
        return buildErrorResult(400, fieldPolicy.message, {
          error: 'validation_failed',
          message: fieldPolicy.message,
          ok: false,
        });
      }

      const captureType = captureTypeForTool(request.tool);
      const status = statusForCaptureType(captureType);
      const idempotencyKey = request.idempotencyKey?.trim() || null;
      const destinationType = normalizeHandoffDestinationType(
        business?.handoff_destination_type,
      );
      const payload: Record<string, unknown> = { ...fieldPolicy.payload };
      if (request.tool === 'offer_human_handoff') {
        payload.destinationType = destinationType;
        if (business?.handoff_destination_value) {
          payload.destinationValue = business.handoff_destination_value;
        }
      }

      const capture = await insertCapture({
        agentId: agent.id,
        captureType,
        conversationId: conversation.id,
        idempotencyKey,
        payload,
        status,
        supabase,
        tenantId: conversation.tenant_id,
      });

      await updateConversationOutcome({
        conversationId: conversation.id,
        outcome: outcomeForCaptureType(captureType),
        supabase,
        tenantId: conversation.tenant_id,
      });

      const successResult: Extract<CaptureToolResult, { ok: true }> = {
        captureId: capture.id,
        captureType,
        ok: true,
        status,
      };

      if (captureType === 'handoff_request') {
        successResult.speakAs = buildHandoffSpeakAs({
          destinationType,
          destinationValue: business?.handoff_destination_value ?? null,
          script: business?.handoff_script ?? null,
        });
      } else {
        const speakAs = speakAsForCaptureType(captureType);
        if (speakAs) {
          successResult.speakAs = speakAs;
        }
      }

      return buildSuccessResult(successResult);
    } catch (error) {
      if (isServerConfigurationError(error)) {
        return buildErrorResult(
          500,
          'Voice capture persistence is not configured on the server.',
        );
      }

      return buildErrorResult(
        500,
        error instanceof Error
          ? error.message
          : 'Unable to persist the capture right now.',
        {
          error: 'persist_failed',
          message:
            error instanceof Error
              ? error.message
              : 'Unable to persist the capture right now.',
          ok: false,
        },
      );
    }
  };
}

export const createConversationCapture = createConversationCaptureService({
  createServerSupabaseAdminClient,
  getSupabaseAdminEnv,
  verifyVoiceSessionToken,
});

export function createConversationCaptureRouteHandler(
  createCapture: typeof createConversationCapture = createConversationCapture,
) {
  return async function POST(
    request: Request,
    context: { params: Promise<{ conversationId: string }> },
  ): Promise<Response> {
    const { conversationId } = await context.params;
    let body: unknown = null;

    try {
      body = await request.json();
    } catch {
      body = null;
    }

    const result = await createCapture({
      authorizationHeader: request.headers.get('authorization'),
      body,
      conversationId,
    });

    return Response.json(result.body, {
      headers: result.headers,
      status: result.status,
    });
  };
}
