import {
  emptyAgentCapabilities,
  normalizeAgentCapabilities,
  type AgentCapabilities,
} from './capabilities';

export const agentStatuses = ['draft', 'active', 'paused'] as const;

export type AgentStatus = (typeof agentStatuses)[number];

export const DEFAULT_IDLE_CHECK_IN_MESSAGE = 'Hello, are you there?';
/** Seconds of mutual silence before speaking the check-in message. */
export const DEFAULT_IDLE_CHECK_IN_SECONDS = 30;
/** Total mutual silence before ending the call (must be greater than ask-at). */
export const DEFAULT_IDLE_END_SECONDS = 60;
export const IDLE_CHECK_IN_MESSAGE_MAX_LENGTH = 200;
export const IDLE_TIMEOUT_SECONDS_MIN = 15;
export const IDLE_TIMEOUT_SECONDS_MAX = 300;

export type AgentValues = {
  capabilities: AgentCapabilities;
  fallbackMessage: string;
  greeting: string;
  idleCheckInMessage: string;
  idleCheckInSeconds: number;
  idleEndSeconds: number;
  idleTimeoutEnabled: boolean;
  interruptionEnabled: boolean;
  language: string;
  maximumSessionDurationSeconds: number;
  name: string;
  role: string;
  silenceTimeoutSeconds: number;
  specialInstructions: string;
  status: AgentStatus;
  tone: string;
  voiceId: string;
};

export type AgentRecord = {
  capabilities?: unknown;
  fallback_message: string | null;
  greeting: string | null;
  id: string;
  idle_check_in_message?: string | null;
  idle_check_in_seconds?: number | null;
  idle_end_seconds?: number | null;
  idle_timeout_enabled?: boolean | null;
  interruption_enabled: boolean;
  language: string;
  maximum_session_duration_seconds: number;
  name: string;
  role: string;
  silence_timeout_seconds: number;
  special_instructions: string | null;
  status: AgentStatus;
  tone: string | null;
  updated_at: string;
  voice_id: string | null;
};

export type AgentListItem = {
  id: string;
  language: string;
  lastUpdated: string;
  name: string;
  role: string;
  status: AgentStatus;
};

export function emptyAgentValues(): AgentValues {
  return {
    capabilities: emptyAgentCapabilities(),
    fallbackMessage: '',
    greeting: '',
    idleCheckInMessage: DEFAULT_IDLE_CHECK_IN_MESSAGE,
    idleCheckInSeconds: DEFAULT_IDLE_CHECK_IN_SECONDS,
    idleEndSeconds: DEFAULT_IDLE_END_SECONDS,
    idleTimeoutEnabled: true,
    interruptionEnabled: true,
    language: 'en',
    maximumSessionDurationSeconds: 900,
    name: '',
    role: '',
    silenceTimeoutSeconds: 8,
    specialInstructions: '',
    status: 'draft',
    tone: '',
    voiceId: '',
  };
}

export function agentRecordToValues(record: AgentRecord): AgentValues {
  return {
    capabilities: normalizeAgentCapabilities(record.capabilities),
    fallbackMessage: record.fallback_message ?? '',
    greeting: record.greeting ?? '',
    idleCheckInMessage:
      record.idle_check_in_message?.trim() || DEFAULT_IDLE_CHECK_IN_MESSAGE,
    idleCheckInSeconds:
      record.idle_check_in_seconds ?? DEFAULT_IDLE_CHECK_IN_SECONDS,
    idleEndSeconds: record.idle_end_seconds ?? DEFAULT_IDLE_END_SECONDS,
    idleTimeoutEnabled: record.idle_timeout_enabled ?? true,
    interruptionEnabled: record.interruption_enabled,
    language: record.language,
    maximumSessionDurationSeconds: record.maximum_session_duration_seconds,
    name: record.name,
    role: record.role,
    silenceTimeoutSeconds: record.silence_timeout_seconds,
    specialInstructions: record.special_instructions ?? '',
    status: record.status,
    tone: record.tone ?? '',
    voiceId: record.voice_id ?? '',
  };
}
