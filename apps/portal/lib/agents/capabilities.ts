import type { HandoffDestinationType } from '../business-configuration/schema';

export const captureFieldOptions = [
  'name',
  'phone',
  'email',
  'notes',
  'message',
  'preferred_time',
  'party',
] as const;

export type CaptureField = (typeof captureFieldOptions)[number];

export const leadFieldOptions = ['name', 'phone', 'email', 'notes'] as const;
export const messageFieldOptions = ['name', 'phone', 'email', 'message'] as const;
export const appointmentFieldOptions = [
  'name',
  'phone',
  'email',
  'preferred_time',
  'party',
  'notes',
] as const;

export type LeadField = (typeof leadFieldOptions)[number];
export type MessageField = (typeof messageFieldOptions)[number];
export type AppointmentField = (typeof appointmentFieldOptions)[number];

export type AgentCapabilities = {
  appointmentFields: AppointmentField[];
  captureAppointments: boolean;
  captureLeads: boolean;
  captureMessages: boolean;
  leadFields: LeadField[];
  messageFields: MessageField[];
  offerHandoff: boolean;
};

export type AgentCapabilitiesRecord = {
  appointment_fields?: unknown;
  capture_appointments?: unknown;
  capture_leads?: unknown;
  capture_messages?: unknown;
  lead_fields?: unknown;
  message_fields?: unknown;
  offer_handoff?: unknown;
};

export type RuntimeToolName =
  | 'capture_lead'
  | 'capture_message'
  | 'create_appointment_request'
  | 'offer_human_handoff'
  | 'end_session';

const defaultLeadFields: LeadField[] = ['name', 'phone', 'email', 'notes'];
const defaultMessageFields: MessageField[] = ['name', 'phone', 'email', 'message'];
const defaultAppointmentFields: AppointmentField[] = [
  'name',
  'phone',
  'email',
  'preferred_time',
  'party',
  'notes',
];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function filterAllowedFields<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T[],
): T[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const allowedSet = new Set<string>(allowed);
  const selected: T[] = [];

  for (const entry of value) {
    if (typeof entry !== 'string') {
      continue;
    }
    const normalized = entry.trim();
    if (!allowedSet.has(normalized)) {
      continue;
    }
    if (!selected.includes(normalized as T)) {
      selected.push(normalized as T);
    }
  }

  return selected.length > 0 ? selected : [...fallback];
}

export function emptyAgentCapabilities(): AgentCapabilities {
  return {
    appointmentFields: [...defaultAppointmentFields],
    captureAppointments: false,
    captureLeads: false,
    captureMessages: false,
    leadFields: [...defaultLeadFields],
    messageFields: [...defaultMessageFields],
    offerHandoff: false,
  };
}

export function normalizeAgentCapabilities(value: unknown): AgentCapabilities {
  const source = isObject(value) ? value : {};

  return {
    appointmentFields: filterAllowedFields(
      source.appointment_fields ?? source.appointmentFields,
      appointmentFieldOptions,
      defaultAppointmentFields,
    ),
    captureAppointments: asBoolean(
      source.capture_appointments ?? source.captureAppointments,
      false,
    ),
    captureLeads: asBoolean(source.capture_leads ?? source.captureLeads, false),
    captureMessages: asBoolean(
      source.capture_messages ?? source.captureMessages,
      false,
    ),
    leadFields: filterAllowedFields(
      source.lead_fields ?? source.leadFields,
      leadFieldOptions,
      defaultLeadFields,
    ),
    messageFields: filterAllowedFields(
      source.message_fields ?? source.messageFields,
      messageFieldOptions,
      defaultMessageFields,
    ),
    offerHandoff: asBoolean(source.offer_handoff ?? source.offerHandoff, false),
  };
}

export function serializeAgentCapabilities(
  capabilities: AgentCapabilities,
): AgentCapabilitiesRecord {
  const normalized = normalizeAgentCapabilities(capabilities);

  return {
    appointment_fields: normalized.appointmentFields,
    capture_appointments: normalized.captureAppointments,
    capture_leads: normalized.captureLeads,
    capture_messages: normalized.captureMessages,
    lead_fields: normalized.leadFields,
    message_fields: normalized.messageFields,
    offer_handoff: normalized.offerHandoff,
  };
}

export function listEnabledRuntimeTools(
  capabilities: AgentCapabilities,
  handoffDestinationType: HandoffDestinationType = 'none',
): RuntimeToolName[] {
  const tools: RuntimeToolName[] = [];

  if (capabilities.captureLeads) {
    tools.push('capture_lead');
  }
  if (capabilities.captureMessages) {
    tools.push('capture_message');
  }
  if (capabilities.captureAppointments) {
    tools.push('create_appointment_request');
  }
  if (capabilities.offerHandoff && handoffDestinationType !== 'none') {
    tools.push('offer_human_handoff');
  }

  tools.push('end_session');
  return tools;
}

export function formatCaptureFields(fields: readonly string[]): string {
  return fields.join(', ');
}
