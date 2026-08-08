import {
  appointmentFieldOptions,
  emptyAgentCapabilities,
  leadFieldOptions,
  messageFieldOptions,
  normalizeAgentCapabilities,
  serializeAgentCapabilities,
  type AppointmentField,
  type LeadField,
  type MessageField,
} from './capabilities';
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
        capabilities: ReturnType<typeof serializeAgentCapabilities>;
        fallback_message: string | null;
        greeting: string | null;
        interruption_enabled: boolean;
        language: string;
        name: string;
        role: string;
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

function isAgentStatus(value: string): value is AgentStatus {
  return agentStatuses.includes(value as AgentStatus);
}

function readCheckedFields<T extends string>(
  formData: FormData,
  name: string,
  allowed: readonly T[],
): T[] {
  const raw = formData.getAll(name);
  const allowedSet = new Set<string>(allowed);
  const selected: T[] = [];

  for (const entry of raw) {
    if (typeof entry !== 'string') {
      continue;
    }
    const value = entry.trim();
    if (!allowedSet.has(value)) {
      continue;
    }
    if (!selected.includes(value as T)) {
      selected.push(value as T);
    }
  }

  return selected;
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

  const status = normalizeText(formData.get('status'));
  values.status = isAgentStatus(status) ? status : 'draft';

  const capabilities = emptyAgentCapabilities();
  capabilities.captureLeads =
    formData.get('capabilities.captureLeads') === 'on' ||
    formData.get('capabilities.captureLeads') === 'true';
  capabilities.captureMessages =
    formData.get('capabilities.captureMessages') === 'on' ||
    formData.get('capabilities.captureMessages') === 'true';
  capabilities.captureAppointments =
    formData.get('capabilities.captureAppointments') === 'on' ||
    formData.get('capabilities.captureAppointments') === 'true';
  capabilities.offerHandoff =
    formData.get('capabilities.offerHandoff') === 'on' ||
    formData.get('capabilities.offerHandoff') === 'true';

  const leadFields = readCheckedFields(
    formData,
    'capabilities.leadFields',
    leadFieldOptions,
  ) as LeadField[];
  const messageFields = readCheckedFields(
    formData,
    'capabilities.messageFields',
    messageFieldOptions,
  ) as MessageField[];
  const appointmentFields = readCheckedFields(
    formData,
    'capabilities.appointmentFields',
    appointmentFieldOptions,
  ) as AppointmentField[];

  if (leadFields.length > 0) {
    capabilities.leadFields = leadFields;
  }
  if (messageFields.length > 0) {
    capabilities.messageFields = messageFields;
  }
  if (appointmentFields.length > 0) {
    capabilities.appointmentFields = appointmentFields;
  }

  if (capabilities.captureLeads && !capabilities.leadFields.includes('name')) {
    errors.push('Lead capture requires the name field.');
  }
  if (
    capabilities.captureMessages &&
    !capabilities.messageFields.includes('message')
  ) {
    errors.push('Message capture requires the message field.');
  }
  if (
    capabilities.captureAppointments &&
    !capabilities.appointmentFields.includes('preferred_time')
  ) {
    errors.push('Appointment capture requires the preferred time field.');
  }
  if (
    capabilities.captureAppointments &&
    !capabilities.appointmentFields.includes('name')
  ) {
    errors.push('Appointment capture requires the name field.');
  }

  values.capabilities = normalizeAgentCapabilities(capabilities);

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

  if (errors.length > 0) {
    return {
      errors,
      values,
    };
  }

  return {
    data: {
      capabilities: serializeAgentCapabilities(values.capabilities),
      fallback_message: optionalText(values.fallbackMessage),
      greeting: optionalText(values.greeting),
      interruption_enabled: values.interruptionEnabled,
      language: values.language,
      name: values.name,
      role: values.role,
      special_instructions: optionalText(values.specialInstructions),
      status: values.status,
      tone: values.tone || DEFAULT_AGENT_TONE,
      voice_id: optionalText(values.voiceId),
    },
    values,
  };
}
