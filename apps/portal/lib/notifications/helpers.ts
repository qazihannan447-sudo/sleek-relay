import {
  buildConversationPagination,
  type ConversationAgentOption,
  type ConversationEmptyState,
  type ConversationPagination,
} from '../conversations/helpers';

export const NOTIFICATION_PAGE_SIZE = 15;

export type NotificationFilterInput = {
  agent?: string | string[] | undefined;
  from?: string | string[] | undefined;
  page?: string | string[] | undefined;
  to?: string | string[] | undefined;
};

export type NormalizedNotificationFilters = {
  agentId: string | null;
  from: string | null;
  fromTimestamp: string | null;
  page: number;
  to: string | null;
  toExclusiveTimestamp: string | null;
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

export function formatNotificationKindLabel(kind: string): string {
  switch (kind) {
    case 'close_off':
      return 'Post-call close-off';
    default:
      return kind;
  }
}

export function formatNotificationChannelLabel(channel: string): string {
  switch (channel) {
    case 'email':
      return 'Email';
    case 'whatsapp':
      return 'WhatsApp';
    default:
      return channel;
  }
}

export function formatNotificationStatusLabel(status: string): string {
  switch (status) {
    case 'sent':
      return 'Sent';
    case 'failed':
      return 'Failed';
    default:
      return status;
  }
}

export function normalizeNotificationFilters(
  input: NotificationFilterInput,
  agents: ConversationAgentOption[],
): NormalizedNotificationFilters {
  const agentIdRaw = pickSingleValue(input.agent);
  const fromRaw = pickSingleValue(input.from);
  const toRaw = pickSingleValue(input.to);
  const pageRaw = pickSingleValue(input.page);

  const agentId =
    agentIdRaw && agents.some((agent) => agent.id === agentIdRaw)
      ? agentIdRaw
      : null;
  const from =
    fromRaw && isIsoDateValue(fromRaw) ? fromRaw : null;
  const to = toRaw && isIsoDateValue(toRaw) ? toRaw : null;
  const fromDate = from ? toUtcDateStart(from) : null;
  const toDate = to ? toUtcDateStart(to) : null;
  const pageNumber = pageRaw ? Number.parseInt(pageRaw, 10) : 1;

  let toExclusiveTimestamp: string | null = null;
  if (toDate) {
    const exclusive = new Date(toDate);
    exclusive.setUTCDate(exclusive.getUTCDate() + 1);
    toExclusiveTimestamp = exclusive.toISOString();
  }

  return {
    agentId,
    from,
    fromTimestamp: fromDate ? fromDate.toISOString() : null,
    page: Number.isFinite(pageNumber) && pageNumber > 0 ? pageNumber : 1,
    to,
    toExclusiveTimestamp,
  };
}

export function hasActiveNotificationFilters(
  filters: NormalizedNotificationFilters,
): boolean {
  return Boolean(filters.agentId || filters.from || filters.to);
}

export function buildNotificationFiltersHref(
  basePath: string,
  filters: NormalizedNotificationFilters,
  overrides?: { page?: number },
): string {
  const params = new URLSearchParams();
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

export function buildNotificationPagination(args: {
  page: number;
  pageSize?: number;
  totalCount: number;
}): ConversationPagination {
  return buildConversationPagination({
    page: args.page,
    pageSize: args.pageSize ?? NOTIFICATION_PAGE_SIZE,
    totalCount: args.totalCount,
  });
}

export function selectNotificationEmptyState(args: {
  hasFilters: boolean;
  resultCount: number;
  totalCount: number;
}): ConversationEmptyState {
  if (args.resultCount > 0) {
    return 'results';
  }
  if (args.hasFilters || args.totalCount > 0) {
    return 'filtered-empty';
  }
  return 'empty';
}

export function truncateNotificationBody(body: string, maxLength = 120): string {
  const normalized = body.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}
