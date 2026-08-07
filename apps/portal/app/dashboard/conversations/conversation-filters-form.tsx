'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import { DatePicker } from '../../../components/date-picker';
import {
  buildConversationFiltersHref,
  conversationStatuses,
  normalizeConversationFilters,
  type NormalizedConversationFilters,
} from '../../../lib/conversations/helpers';
import { CustomSelect } from '../agents/custom-select';

type ConversationFiltersFormProps = {
  agents: { id: string; name: string }[];
  filters: NormalizedConversationFilters;
};

export function ConversationFiltersForm({
  agents,
  filters,
}: ConversationFiltersFormProps) {
  const router = useRouter();
  const [status, setStatus] = useState(filters.status ?? '');
  const [agentId, setAgentId] = useState(filters.agentId ?? '');
  const [from, setFrom] = useState(filters.from ?? '');
  const [to, setTo] = useState(filters.to ?? '');

  useEffect(() => {
    setStatus(filters.status ?? '');
    setAgentId(filters.agentId ?? '');
    setFrom(filters.from ?? '');
    setTo(filters.to ?? '');
  }, [filters.agentId, filters.from, filters.status, filters.to]);

  const statusOptions = [
    { label: 'All statuses', value: '' },
    ...conversationStatuses.map((item) => ({
      label: item.charAt(0).toUpperCase() + item.slice(1),
      value: item,
    })),
  ];

  const agentOptions = [
    { label: 'All agents', value: '' },
    ...agents.map((agent) => ({
      label: agent.name,
      value: agent.id,
    })),
  ];

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextFilters = normalizeConversationFilters(
      {
        agent: agentId || undefined,
        from: from || undefined,
        page: '1',
        status: status || undefined,
        to: to || undefined,
      },
      agents,
    );

    router.push(buildConversationFiltersHref('/dashboard/conversations', nextFilters));
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
            <label htmlFor="conversation-status-filter">Status</label>
            <CustomSelect
              id="conversation-status-filter"
              name="status"
              onChange={setStatus}
              options={statusOptions}
              value={status}
            />
          </div>

          <div className="field">
            <label htmlFor="conversation-agent-filter">Agent</label>
            <CustomSelect
              id="conversation-agent-filter"
              name="agent"
              onChange={setAgentId}
              options={agentOptions}
              value={agentId}
            />
          </div>

          <div className="field">
            <label htmlFor="conversation-from-filter">From</label>
            <DatePicker
              id="conversation-from-filter"
              name="from"
              onChange={setFrom}
              placeholder="mm/dd/yyyy"
              value={from}
            />
          </div>

          <div className="field">
            <label htmlFor="conversation-to-filter">To</label>
            <DatePicker
              id="conversation-to-filter"
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
            <Link className="button-secondary" href="/dashboard/conversations">
              Clear filters
            </Link>
          </div>
        </div>
      </form>
    </section>
  );
}
