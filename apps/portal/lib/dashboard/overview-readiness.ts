import {
  businessHoursDays,
  normalizeBusinessHours,
  type BusinessHours,
} from '../business-configuration/schema';
import {
  DEFAULT_TENANT_CONNECTED_MINUTE_CAP,
  msToMinutes,
  resolveConnectedDurationMs,
} from '../usage/build-analytics';
import type { UsageCapStatus } from '../usage/types';

export type OverviewReadinessItemId =
  | 'active_agent'
  | 'approved_knowledge'
  | 'business_name'
  | 'contact'
  | 'hours';

export type OverviewReadinessItem = {
  complete: boolean;
  href: string;
  id: OverviewReadinessItemId;
  label: string;
};

export type OverviewBusinessInput = {
  businessHours: unknown;
  businessName: string | null;
  businessPhone: string | null;
  contactEmail: string | null;
};

export type OverviewUsageConversationInput = {
  durationMs: number | null;
  endedAt: string | null;
  startedAt: string;
  status: string;
};

export type OverviewUsageSnapshot = {
  capMinutes: number;
  capStatus: UsageCapStatus;
  connectedMinutes: number;
  sessionCount: number;
  usedPercent: number;
};

function hasText(value: string | null | undefined): boolean {
  return Boolean(value && value.trim().length > 0);
}

export function hasConfiguredBusinessHours(hours: BusinessHours): boolean {
  return businessHoursDays.some((day) => {
    const entry = hours[day.key];
    return (
      entry.closed === false &&
      hasText(entry.open) &&
      hasText(entry.close)
    );
  });
}

export function buildOverviewReadiness(args: {
  activeAgentCount: number;
  approvedKnowledgeCount: number;
  business: OverviewBusinessInput | null;
}): {
  completedCount: number;
  items: OverviewReadinessItem[];
  status: 'ready' | 'incomplete' | 'missing';
  totalCount: number;
} {
  const business = args.business;
  const hours = normalizeBusinessHours(business?.businessHours ?? null);

  const items: OverviewReadinessItem[] = [
    {
      complete: hasText(business?.businessName),
      href: '/dashboard/business',
      id: 'business_name',
      label: 'Business name',
    },
    {
      complete:
        hasText(business?.businessPhone) || hasText(business?.contactEmail),
      href: '/dashboard/business',
      id: 'contact',
      label: 'Contact phone or email',
    },
    {
      complete: hasConfiguredBusinessHours(hours),
      href: '/dashboard/business',
      id: 'hours',
      label: 'Business hours',
    },
    {
      complete: args.approvedKnowledgeCount > 0,
      href: '/dashboard/business',
      id: 'approved_knowledge',
      label: 'Approved knowledge',
    },
    {
      complete: args.activeAgentCount > 0,
      href: '/dashboard/agents',
      id: 'active_agent',
      label: 'Active agent',
    },
  ];

  const completedCount = items.filter((item) => item.complete).length;
  const totalCount = items.length;

  if (!business || !hasText(business.businessName)) {
    return {
      completedCount,
      items,
      status: 'missing',
      totalCount,
    };
  }

  return {
    completedCount,
    items,
    status: completedCount === totalCount ? 'ready' : 'incomplete',
    totalCount,
  };
}

export function buildOverviewUsageSnapshot(
  conversations: OverviewUsageConversationInput[],
  options?: {
    capMinutes?: number;
    now?: Date;
  },
): OverviewUsageSnapshot {
  const now = options?.now ?? new Date();
  const capMinutes = options?.capMinutes ?? DEFAULT_TENANT_CONNECTED_MINUTE_CAP;
  const nowMs = now.getTime();

  let connectedMs = 0;
  let sessionCount = 0;

  for (const conversation of conversations) {
    if (
      conversation.status !== 'completed' &&
      conversation.status !== 'failed'
    ) {
      continue;
    }

    sessionCount += 1;
    connectedMs += resolveConnectedDurationMs(
      {
        durationMs: conversation.durationMs,
        endedAt: conversation.endedAt,
        startedAt: conversation.startedAt,
      },
      nowMs,
    );
  }

  const connectedMinutes = Math.round(msToMinutes(connectedMs) * 10) / 10;
  const usedPercent =
    capMinutes > 0
      ? Math.min(999, Math.round((connectedMinutes / capMinutes) * 100))
      : 0;

  let capStatus: UsageCapStatus = 'within';
  if (usedPercent >= 100) {
    capStatus = 'exceeded';
  } else if (usedPercent >= 80) {
    capStatus = 'warning';
  }

  return {
    capMinutes,
    capStatus,
    connectedMinutes,
    sessionCount,
    usedPercent,
  };
}

export function overviewReadinessStatusLabel(
  status: 'ready' | 'incomplete' | 'missing',
): string {
  switch (status) {
    case 'ready':
      return 'Ready';
    case 'incomplete':
      return 'Incomplete';
    default:
      return 'Missing';
  }
}

export function pickPrimaryTestAgentId(
  agents: Array<{ id: string; status: string }>,
): string | null {
  const active = agents.find((agent) => agent.status === 'active');
  return active?.id ?? null;
}

export function selectOverviewAgentPreview<T extends { status: string }>(
  agents: T[],
  limit = 4,
): T[] {
  if (agents.length <= limit) {
    return agents;
  }

  const active = agents.filter((agent) => agent.status === 'active');
  const rest = agents.filter((agent) => agent.status !== 'active');
  return [...active, ...rest].slice(0, limit);
}
