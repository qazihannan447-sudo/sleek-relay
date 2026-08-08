import Link from 'next/link';

import {
  buildUsagePeriodHref,
  USAGE_PERIODS,
} from '../../../lib/usage/period';
import type { UsagePeriodId } from '../../../lib/usage/types';

type UsagePeriodTabsProps = {
  activePeriod: UsagePeriodId;
};

export function UsagePeriodTabs({ activePeriod }: UsagePeriodTabsProps) {
  return (
    <div aria-label="Usage period" className="usage-period-tabs" role="tablist">
      {USAGE_PERIODS.map((period) => (
        <Link
          aria-selected={period.id === activePeriod}
          className={
            period.id === activePeriod
              ? 'usage-period-tab usage-period-tab-active'
              : 'usage-period-tab'
          }
          href={buildUsagePeriodHref(period.id)}
          key={period.id}
          prefetch={true}
          role="tab"
        >
          {period.label}
        </Link>
      ))}
    </div>
  );
}
