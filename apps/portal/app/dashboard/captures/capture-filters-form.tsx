'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import { DatePicker } from '../../../components/date-picker';
import {
  buildCaptureFiltersHref,
  captureTypeOptions,
  formatCaptureTypeLabel,
  normalizeCaptureFilters,
  type NormalizedCaptureFilters,
} from '../../../lib/captures/helpers';
import { CustomSelect } from '../agents/custom-select';

type CaptureFiltersFormProps = {
  agents: { id: string; name: string }[];
  filters: NormalizedCaptureFilters;
};

export function CaptureFiltersForm({
  agents,
  filters,
}: CaptureFiltersFormProps) {
  const router = useRouter();
  const [type, setType] = useState(filters.type ?? '');
  const [agentId, setAgentId] = useState(filters.agentId ?? '');
  const [from, setFrom] = useState(filters.from ?? '');
  const [to, setTo] = useState(filters.to ?? '');

  useEffect(() => {
    setType(filters.type ?? '');
    setAgentId(filters.agentId ?? '');
    setFrom(filters.from ?? '');
    setTo(filters.to ?? '');
  }, [filters.agentId, filters.from, filters.to, filters.type]);

  const typeOptions = [
    { label: 'All types', value: '' },
    ...captureTypeOptions.map((item) => ({
      label: formatCaptureTypeLabel(item),
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

    const nextFilters = normalizeCaptureFilters(
      {
        agent: agentId || undefined,
        from: from || undefined,
        page: '1',
        to: to || undefined,
        type: type || undefined,
      },
      agents,
    );

    router.push(buildCaptureFiltersHref('/dashboard/captures', nextFilters));
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
            <label htmlFor="capture-type-filter">Type</label>
            <CustomSelect
              id="capture-type-filter"
              name="type"
              onChange={setType}
              options={typeOptions}
              value={type}
            />
          </div>

          <div className="field">
            <label htmlFor="capture-agent-filter">Agent</label>
            <CustomSelect
              id="capture-agent-filter"
              name="agent"
              onChange={setAgentId}
              options={agentOptions}
              value={agentId}
            />
          </div>

          <div className="field">
            <label htmlFor="capture-from-filter">From</label>
            <DatePicker
              id="capture-from-filter"
              name="from"
              onChange={setFrom}
              placeholder="mm/dd/yyyy"
              value={from}
            />
          </div>

          <div className="field">
            <label htmlFor="capture-to-filter">To</label>
            <DatePicker
              id="capture-to-filter"
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
            <Link className="button-secondary" href="/dashboard/captures">
              Clear filters
            </Link>
          </div>
        </div>
      </form>
    </section>
  );
}
