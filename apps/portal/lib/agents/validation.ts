import {
  agentStatuses,
  emptyAgentValues,
  type AgentStatus,
  type AgentValues,
} from './schema';
import { DEFAULT_AGENT_TONE, formatAgentToneValue } from './tones';

export type AgentActionState = {
  message: string | null;
  status: 'error' | 'idle' | 'success';
  values: AgentValues;
};

export type AgentValidationResult =
  | {
      errors: string[];
      values: AgentValues;
    }
  | {
      data: {
        fallback_message: string | null;
        greeting: string | null;
        interruption_enabled: boolean;
        language: string;
        maximum_session_duration_seconds: number;
        name: string;
        role: string;
        silence_timeout_seconds: number;
        special_instructions: string | null;
        status: AgentStatus;
        tone: string | null;
        voice_id: string | null;
      };
      values: AgentValues;
    };

function normalizeText(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalText(value: string): string | null {
  return value.length > 0 ? value : null;
}

function parseInteger(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isAgentStatus(value: string): value is AgentStatus {
  return agentStatuses.includes(value as AgentStatus);
}

export function initialAgentActionState(values: AgentValues): AgentActionState {
  return {
    message: null,
    status: 'idle',
    values,
  };
}

export function parseAgentForm(formData: FormData): AgentValidationResult {
  const values = emptyAgentValues();
  const errors: string[] = [];

  values.name = normalizeText(formData.get('name'));
  values.role = normalizeText(formData.get('role'));
  values.language = normalizeText(formData.get('language')).toLowerCase();
  values.greeting = normalizeText(formData.get('greeting'));
  values.voiceId = normalizeText(formData.get('voiceId'));
  values.tone = formatAgentToneValue(normalizeText(formData.get('tone')));
  values.specialInstructions = normalizeText(formData.get('specialInstructions'));
  values.fallbackMessage = normalizeText(formData.get('fallbackMessage'));
  values.interruptionEnabled = formData.has('interruptionEnabled')
    ? formData.get('interruptionEnabled') === 'on' || formData.get('interruptionEnabled') === 'true'
    : true;
  values.silenceTimeoutSeconds = parseInteger(
    normalizeText(formData.get('silenceTimeoutSeconds')),
    8,
  );
  values.maximumSessionDurationSeconds = parseInteger(
    normalizeText(formData.get('maximumSessionDurationSeconds')),
    900,
  );

  const status = normalizeText(formData.get('status'));
  values.status = isAgentStatus(status) ? status : 'draft';

  if (!values.name) {
    errors.push('Agent name is required.');
  }

  if (!values.role) {
    errors.push('Agent role is required.');
  }

  if (!values.language) {
    errors.push('Language is required.');
  } else if (!/^[a-z]{2,12}(-[a-z]{2,12})?$/.test(values.language)) {
    errors.push('Language must be a simple language code such as en or en-us.');
  }

  if (!isAgentStatus(status)) {
    errors.push('Status must be draft, active, or paused.');
  }

  if (
    values.silenceTimeoutSeconds < 3 ||
    values.silenceTimeoutSeconds > 120
  ) {
    errors.push('Silence timeout must be between 3 and 120 seconds.');
  }

  if (
    values.maximumSessionDurationSeconds < 60 ||
    values.maximumSessionDurationSeconds > 7200
  ) {
    errors.push('Maximum session duration must be between 60 and 7200 seconds.');
  }

  if (errors.length > 0) {
    return {
      errors,
      values,
    };
  }

  return {
    data: {
      fallback_message: optionalText(values.fallbackMessage),
      greeting: optionalText(values.greeting),
      interruption_enabled: values.interruptionEnabled,
      language: values.language,
      maximum_session_duration_seconds: values.maximumSessionDurationSeconds,
      name: values.name,
      role: values.role,
      silence_timeout_seconds: values.silenceTimeoutSeconds,
      special_instructions: optionalText(values.specialInstructions),
      status: values.status,
      tone: values.tone || DEFAULT_AGENT_TONE,
      voice_id: optionalText(values.voiceId),
    },
    values,
  };
}

