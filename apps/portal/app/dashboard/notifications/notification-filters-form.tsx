'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import { DatePicker } from '../../../components/date-picker';
import {
  buildNotificationFiltersHref,
  normalizeNotificationFilters,
  type NormalizedNotificationFilters,
} from '../../../lib/notifications/helpers';
import { CustomSelect } from '../agents/custom-select';

type NotificationFiltersFormProps = {
  agents: { id: string; name: string }[];
  filters: NormalizedNotificationFilters;
};

export function NotificationFiltersForm({
  agents,
  filters,
}: NotificationFiltersFormProps) {
  const router = useRouter();
  const [agentId, setAgentId] = useState(filters.agentId ?? '');
  const [from, setFrom] = useState(filters.from ?? '');
  const [to, setTo] = useState(filters.to ?? '');

  useEffect(() => {
    setAgentId(filters.agentId ?? '');
    setFrom(filters.from ?? '');
    setTo(filters.to ?? '');
  }, [filters.agentId, filters.from, filters.to]);

  const agentOptions = [
    { label: 'All agents', value: '' },
    ...agents.map((agent) => ({
      label: agent.name,
      value: agent.id,
    })),
  ];

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextFilters = normalizeNotificationFilters(
      {
        agent: agentId || undefined,
        from: from || undefined,
        page: '1',
        to: to || undefined,
      },
      agents,
    );

    router.push(
      buildNotificationFiltersHref('/dashboard/notifications', nextFilters),
    );
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2 className="panel-title">Filters</h2>
          <p className="panel-subtitle">
            Filters are resolved server-side inside the authenticated tenant scope.
          </p>
        </div>
      </div>

      <form className="filter-form" onSubmit={handleSubmit}>
        <div className="filter-grid">
          <div className="field">
            <label htmlFor="notification-agent-filter">Agent</label>
            <CustomSelect
              id="notification-agent-filter"
              name="agent"
              onChange={setAgentId}
              options={agentOptions}
              value={agentId}
            />
          </div>

          <div className="field">
            <label htmlFor="notification-from-filter">From</label>
            <DatePicker
              id="notification-from-filter"
              name="from"
              onChange={setFrom}
              placeholder="mm/dd/yyyy"
              value={from}
            />
          </div>

          <div className="field">
            <label htmlFor="notification-to-filter">To</label>
            <DatePicker
              id="notification-to-filter"
              name="to"
              onChange={setTo}
              placeholder="mm/dd/yyyy"
              value={to}
            />
          </div>

          <div className="filter-actions">
            <button className="button" type="submit">
              Apply filters
            </button>
            <Link className="button-secondary" href="/dashboard/notifications">
              Clear filters
            </Link>
          </div>
        </div>
      </form>
    </section>
  );
}
