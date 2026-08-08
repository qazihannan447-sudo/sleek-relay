import { z } from 'zod';

import {
  normalizeAgentCapabilities,
  type AgentCapabilities,
} from '../agents/capabilities';
import type { HandoffDestinationType } from '../business-configuration/schema';

export const captureToolNames = [
  'capture_lead',
  'capture_message',
  'create_appointment_request',
  'offer_human_handoff',
] as const;

export type CaptureToolName = (typeof captureToolNames)[number];

export const captureTypes = [
  'lead',
  'message',
  'appointment_request',
  'handoff_request',
] as const;

export type CaptureType = (typeof captureTypes)[number];

export const captureStatuses = ['captured', 'requested'] as const;

export type CaptureStatus = (typeof captureStatuses)[number];

const optionalContact = z.preprocess(
  (value) => {
    if (typeof value !== 'string') {
      return value;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  },
  z.string().max(200).optional(),
);

const optionalNotes = z.preprocess(
  (value) => {
    if (typeof value !== 'string') {
      return value;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  },
  z.string().max(2000).optional(),
);

export const captureLeadArgsSchema = z.object({
  email: optionalContact,
  name: z.string().trim().min(1).max(200),
  notes: optionalNotes,
  phone: optionalContact,
});

export const captureMessageArgsSchema = z.object({
  email: optionalContact,
  message: z.string().trim().min(1).max(4000),
  name: optionalContact,
  phone: optionalContact,
});

export const createAppointmentRequestArgsSchema = z.object({
  email: optionalContact,
  name: z.string().trim().min(1).max(200),
  notes: optionalNotes,
  party: optionalContact,
  phone: optionalContact,
  preferredTime: z.string().trim().min(1).max(200),
});

export const offerHumanHandoffArgsSchema = z.object({
  callbackEmail: optionalContact,
  callbackPhone: optionalContact,
  callerName: optionalContact,
  reason: z.string().trim().min(1).max(2000),
});

export const createCaptureRequestSchema = z.object({
  args: z.record(z.unknown()),
  idempotencyKey: z.string().trim().min(1).max(120).optional(),
  tool: z.enum(captureToolNames),
});

export type CaptureLeadArgs = z.infer<typeof captureLeadArgsSchema>;
export type CaptureMessageArgs = z.infer<typeof captureMessageArgsSchema>;
export type CreateAppointmentRequestArgs = z.infer<
  typeof createAppointmentRequestArgsSchema
>;
export type OfferHumanHandoffArgs = z.infer<typeof offerHumanHandoffArgsSchema>;
export type CreateCaptureRequest = z.infer<typeof createCaptureRequestSchema>;

export type CaptureToolPayload =
  | CaptureLeadArgs
  | CaptureMessageArgs
  | CreateAppointmentRequestArgs
  | OfferHumanHandoffArgs;

export type CaptureToolResult =
  | {
      captureId: string;
      captureType: CaptureType;
      ok: true;
      status: CaptureStatus;
      /** Spoken guidance for the LLM after a successful write. */
      speakAs?: string;
    }
  | {
      error: 'validation_failed' | 'not_allowed' | 'persist_failed';
      message: string;
      ok: false;
    };

export function captureTypeForTool(tool: CaptureToolName): CaptureType {
  if (tool === 'capture_lead') {
    return 'lead';
  }
  if (tool === 'capture_message') {
    return 'message';
  }
  if (tool === 'create_appointment_request') {
    return 'appointment_request';
  }
  return 'handoff_request';
}

export function statusForCaptureType(captureType: CaptureType): CaptureStatus {
  if (
    captureType === 'appointment_request' ||
    captureType === 'handoff_request'
  ) {
    return 'requested';
  }
  return 'captured';
}

export function outcomeForCaptureType(captureType: CaptureType): string {
  if (captureType === 'lead') {
    return 'lead_captured';
  }
  if (captureType === 'message') {
    return 'message_captured';
  }
  if (captureType === 'appointment_request') {
    return 'appointment_requested';
  }
  return 'handoff_requested';
}

export function speakAsForCaptureType(captureType: CaptureType): string | undefined {
  if (captureType !== 'appointment_request') {
    return undefined;
  }
  return (
    'I have submitted that appointment request. The team will confirm it with you. ' +
    'Do not say the caller is booked or that the appointment is confirmed.'
  );
}

export function isHandoffDestinationConfigured(
  destinationType: HandoffDestinationType | string | null | undefined,
): boolean {
  return (
    typeof destinationType === 'string' &&
    destinationType !== 'none' &&
    (destinationType === 'callback' ||
      destinationType === 'phone_info' ||
      destinationType === 'email_info')
  );
}

export function buildHandoffSpeakAs(args: {
  destinationType: HandoffDestinationType;
  destinationValue: string | null;
  script: string | null;
}): string {
  const destinationValue = args.destinationValue?.trim() || '';
  const script = args.script?.trim() || '';

  const withDestination = (template: string): string => {
    if (!destinationValue) {
      return template
        .replaceAll('{destination}', 'the team')
        .replaceAll('{value}', 'the team')
        .replaceAll('{phone}', 'the team')
        .replaceAll('{email}', 'the team');
    }
    return template
      .replaceAll('{destination}', destinationValue)
      .replaceAll('{value}', destinationValue)
      .replaceAll('{phone}', destinationValue)
      .replaceAll('{email}', destinationValue);
  };

  if (script) {
    const spoken = withDestination(script);
    if (
      destinationValue &&
      (args.destinationType === 'phone_info' ||
        args.destinationType === 'email_info') &&
      !spoken.includes(destinationValue)
    ) {
      return `${spoken} Use this contact: ${destinationValue}.`;
    }
    return (
      spoken +
      ' Do not claim a live transfer happened. This is a soft handoff only.'
    );
  }

  if (args.destinationType === 'phone_info') {
    return withDestination(
      'You can reach the team at {destination}. Do not claim a live transfer happened.',
    );
  }
  if (args.destinationType === 'email_info') {
    return withDestination(
      'You can reach the team at {destination}. Do not claim a live transfer happened.',
    );
  }

  return (
    'I have noted your request for a callback. Someone from the team will follow up. ' +
    'Do not claim a live transfer happened.'
  );
}

export function isCaptureToolAllowed(
  tool: CaptureToolName,
  capabilities: AgentCapabilities,
): boolean {
  if (tool === 'capture_lead') {
    return capabilities.captureLeads;
  }
  if (tool === 'capture_message') {
    return capabilities.captureMessages;
  }
  if (tool === 'create_appointment_request') {
    return capabilities.captureAppointments;
  }
  return capabilities.offerHandoff;
}

export function parseCreateCaptureRequest(body: unknown):
  | { ok: true; value: CreateCaptureRequest }
  | { ok: false; message: string } {
  const parsed = createCaptureRequestSchema.safeParse(body);
  if (!parsed.success) {
    return {
      message: parsed.error.issues[0]?.message ?? 'Invalid capture request.',
      ok: false,
    };
  }
  return { ok: true, value: parsed.data };
}

function normalizeAppointmentArgs(
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (typeof args.preferredTime === 'string') {
    return args;
  }
  if (typeof args.preferred_time === 'string') {
    return {
      ...args,
      preferredTime: args.preferred_time,
    };
  }
  return args;
}

function normalizeHandoffArgs(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...args };

  if (
    typeof normalized.callerName !== 'string' &&
    typeof normalized.caller_name === 'string'
  ) {
    normalized.callerName = normalized.caller_name;
  }
  if (
    typeof normalized.callbackPhone !== 'string' &&
    typeof normalized.callback_phone === 'string'
  ) {
    normalized.callbackPhone = normalized.callback_phone;
  }
  if (
    typeof normalized.callbackEmail !== 'string' &&
    typeof normalized.callback_email === 'string'
  ) {
    normalized.callbackEmail = normalized.callback_email;
  }

  return normalized;
}

export function parseCaptureToolArgs(
  tool: CaptureToolName,
  args: Record<string, unknown>,
):
  | { ok: true; payload: CaptureToolPayload }
  | { ok: false; message: string } {
  if (tool === 'capture_lead') {
    const parsed = captureLeadArgsSchema.safeParse(args);
    if (!parsed.success) {
      return {
        message:
          parsed.error.issues[0]?.message ??
          'Lead capture requires a valid name.',
        ok: false,
      };
    }
    return { ok: true, payload: parsed.data };
  }

  if (tool === 'capture_message') {
    const parsed = captureMessageArgsSchema.safeParse(args);
    if (!parsed.success) {
      return {
        message:
          parsed.error.issues[0]?.message ??
          'Message capture requires a valid message.',
        ok: false,
      };
    }
    return { ok: true, payload: parsed.data };
  }

  if (tool === 'create_appointment_request') {
    const parsed = createAppointmentRequestArgsSchema.safeParse(
      normalizeAppointmentArgs(args),
    );
    if (!parsed.success) {
      return {
        message:
          parsed.error.issues[0]?.message ??
          'Appointment requests require a name and preferred time.',
        ok: false,
      };
    }
    return { ok: true, payload: parsed.data };
  }

  const parsed = offerHumanHandoffArgsSchema.safeParse(
    normalizeHandoffArgs(args),
  );
  if (!parsed.success) {
    return {
      message:
        parsed.error.issues[0]?.message ??
        'Handoff requests require a valid reason.',
      ok: false,
    };
  }
  return { ok: true, payload: parsed.data };
}

export function capabilitiesFromUnknown(value: unknown): AgentCapabilities {
  return normalizeAgentCapabilities(value);
}

const CAPTURE_FIELD_TO_PAYLOAD_KEY: Record<string, string> = {
  email: 'email',
  message: 'message',
  name: 'name',
  notes: 'notes',
  party: 'party',
  phone: 'phone',
  preferred_time: 'preferredTime',
};

const OPTIONAL_CAPTURE_FIELDS = new Set(['notes']);

function configuredFieldsForTool(
  tool: CaptureToolName,
  capabilities: AgentCapabilities,
): readonly string[] | null {
  if (tool === 'capture_lead') {
    return capabilities.leadFields;
  }
  if (tool === 'capture_message') {
    return capabilities.messageFields;
  }
  if (tool === 'create_appointment_request') {
    return capabilities.appointmentFields;
  }
  return null;
}

function formatCaptureFieldLabel(field: string): string {
  return field.replaceAll('_', ' ');
}

/**
 * Enforce agent capability field checklists:
 * - listed non-notes fields are required
 * - payload keys outside the checklist are stripped
 * - notes stays optional even when listed
 */
export function applyCapabilityFieldPolicy(
  tool: CaptureToolName,
  payload: CaptureToolPayload,
  capabilities: AgentCapabilities,
):
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; message: string } {
  const configuredFields = configuredFieldsForTool(tool, capabilities);
  if (!configuredFields) {
    return { ok: true, payload: { ...payload } };
  }

  const allowedKeys = new Set<string>();
  for (const field of configuredFields) {
    const payloadKey = CAPTURE_FIELD_TO_PAYLOAD_KEY[field];
    if (payloadKey) {
      allowedKeys.add(payloadKey);
    }
  }

  const source = payload as Record<string, unknown>;
  const filtered: Record<string, unknown> = {};
  for (const key of allowedKeys) {
    if (source[key] !== undefined) {
      filtered[key] = source[key];
    }
  }

  for (const field of configuredFields) {
    if (OPTIONAL_CAPTURE_FIELDS.has(field)) {
      continue;
    }
    const payloadKey = CAPTURE_FIELD_TO_PAYLOAD_KEY[field];
    if (!payloadKey) {
      continue;
    }
    const value = filtered[payloadKey];
    if (typeof value !== 'string' || !value.trim()) {
      return {
        message: `This agent requires ${formatCaptureFieldLabel(field)} for ${tool.replaceAll('_', ' ')}.`,
        ok: false,
      };
    }
  }

  return { ok: true, payload: filtered };
}
