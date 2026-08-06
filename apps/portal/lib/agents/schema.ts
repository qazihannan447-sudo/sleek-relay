export const agentStatuses = ['draft', 'active', 'paused'] as const;

export type AgentStatus = (typeof agentStatuses)[number];

export type AgentValues = {
  fallbackMessage: string;
  greeting: string;
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
  fallback_message: string | null;
  greeting: string | null;
  id: string;
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
    fallbackMessage: '',
    greeting: '',
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
    fallbackMessage: record.fallback_message ?? '',
    greeting: record.greeting ?? '',
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

