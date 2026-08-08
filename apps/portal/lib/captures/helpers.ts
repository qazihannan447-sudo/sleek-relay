import {
  buildConversationPagination,
  type ConversationAgentOption,
  type ConversationEmptyState,
  type ConversationPagination,
} from '../conversations/helpers';

export const CAPTURE_PAGE_SIZE = 15;

export const captureTypeOptions = [
  'lead',
  'message',
  'appointment_request',
  'handoff_request',
] as const;

export type CaptureListType = (typeof captureTypeOptions)[number];

export type CaptureFilterInput = {
  agent?: string | string[] | undefined;
  from?: string | string[] | undefined;
  page?: string | string[] | undefined;
  to?: string | string[] | undefined;
  type?: string | string[] | undefined;
};

export type NormalizedCaptureFilters = {
  agentId: string | null;
  from: string | null;
  fromTimestamp: string | null;
  page: number;
  to: string | null;
  toExclusiveTimestamp: string | null;
  type: CaptureListType | null;
};

function pickSingleValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

function isIsoDateValue(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toUtcDateStart(value: string): Date | null {
  if (!isIsoDateValue(value)) {
    return null;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatCaptureTypeLabel(captureType: string): string {
  switch (captureType) {
    case 'lead':
      return 'Lead';
    case 'message':
      return 'Message';
    case 'appointment_request':
      return 'Appointment request';
    case 'handoff_request':
      return 'Handoff request';
    default:
      return captureType;
  }
}

export function formatCaptureStatusLabel(status: string): string {
  switch (status) {
    case 'captured':
      return 'Captured';
    case 'requested':
      return 'Requested';
    default:
      return status;
  }
}

export function formatCapturePayloadFields(
  payload: unknown,
): Array<{ label: string; value: string }> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return [];
  }

  const labels: Record<string, string> = {
    callbackEmail: 'Callback email',
    callbackPhone: 'Callback phone',
    callerName: 'Caller name',
    destinationType: 'Destination type',
    destinationValue: 'Destination value',
    email: 'Email',
    message: 'Message',
    name: 'Name',
    notes: 'Notes',
    party: 'Party',
    phone: 'Phone',
    preferred_time: 'Preferred time',
    preferredTime: 'Preferred time',
    reason: 'Reason',
  };

  const fields: Array<{ label: string; value: string }> = [];
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (typeof value !== 'string' || !value.trim()) {
      continue;
    }
    fields.push({
      label: labels[key] ?? key,
      value: value.trim(),
    });
  }
  return fields;
}

export function summarizeCapturePayload(payload: unknown): {
  contact: string;
  primary: string;
} {
  const fields = formatCapturePayloadFields(payload);
  const byLabel = new Map(fields.map((field) => [field.label, field.value]));

  const primary =
    byLabel.get('Name') ||
    byLabel.get('Caller name') ||
    byLabel.get('Message') ||
    byLabel.get('Reason') ||
    byLabel.get('Notes') ||
    'No details';

  const contactParts = [
    byLabel.get('Phone'),
    byLabel.get('Callback phone'),
    byLabel.get('Email'),
    byLabel.get('Callback email'),
  ].filter(Boolean);

  return {
    contact: contactParts.length > 0 ? contactParts.join(' · ') : '—',
    primary,
  };
}

export function parseCaptureType(
  value: string | string[] | undefined,
): CaptureListType | null {
  const normalized = pickSingleValue(value)?.trim();
  if (!normalized) {
    return null;
  }
  return captureTypeOptions.includes(normalized as CaptureListType)
    ? (normalized as CaptureListType)
    : null;
}

export function normalizeCaptureFilters(
  input: CaptureFilterInput,
  agents: ConversationAgentOption[],
): NormalizedCaptureFilters {
  const fromRaw = pickSingleValue(input.from)?.trim() ?? null;
  const toRaw = pickSingleValue(input.to)?.trim() ?? null;
  const fromDate = fromRaw ? toUtcDateStart(fromRaw) : null;
  const toDate = toRaw ? toUtcDateStart(toRaw) : null;

  const agentRaw = pickSingleValue(input.agent)?.trim() ?? null;
  const agentId =
    agentRaw && agents.some((agent) => agent.id === agentRaw) ? agentRaw : null;

  const pageRaw = Number.parseInt(pickSingleValue(input.page) ?? '1', 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  let toExclusiveTimestamp: string | null = null;
  if (toDate) {
    const exclusive = new Date(toDate);
    exclusive.setUTCDate(exclusive.getUTCDate() + 1);
    toExclusiveTimestamp = exclusive.toISOString();
  }

  return {
    agentId,
    from: fromDate ? fromRaw : null,
    fromTimestamp: fromDate ? fromDate.toISOString() : null,
    page,
    to: toDate ? toRaw : null,
    toExclusiveTimestamp,
    type: parseCaptureType(input.type),
  };
}

export function hasActiveCaptureFilters(filters: NormalizedCaptureFilters): boolean {
  return Boolean(
    filters.agentId || filters.from || filters.to || filters.type,
  );
}

export function selectCaptureEmptyState(args: {
  hasActiveFilters: boolean;
  totalCount: number;
  visibleCount: number;
}): ConversationEmptyState {
  if (args.visibleCount > 0) {
    return 'results';
  }
  if (args.hasActiveFilters || args.totalCount > 0) {
    return 'filtered-empty';
  }
  return 'empty';
}

export function buildCaptureFiltersHref(
  basePath: string,
  filters: NormalizedCaptureFilters,
  overrides?: Partial<{ page: number }>,
): string {
  const params = new URLSearchParams();
  if (filters.type) {
    params.set('type', filters.type);
  }
  if (filters.agentId) {
    params.set('agent', filters.agentId);
  }
  if (filters.from) {
    params.set('from', filters.from);
  }
  if (filters.to) {
    params.set('to', filters.to);
  }
  const page = overrides?.page ?? filters.page;
  if (page > 1) {
    params.set('page', String(page));
  }
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

export function buildCapturePagination(args: {
  page: number;
  pageSize?: number;
  totalCount: number;
}): ConversationPagination {
  return buildConversationPagination({
    page: args.page,
    pageSize: args.pageSize ?? CAPTURE_PAGE_SIZE,
    totalCount: args.totalCount,
  });
}
