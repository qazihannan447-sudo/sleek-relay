import Link from 'next/link';
import type { ReactNode } from 'react';

import {
  AgentsIcon,
  BuildingIcon,
  BusinessIcon,
  ClockIcon,
  ConversationsIcon,
  OverviewIcon,
  RelayIcon,
  ShieldIcon,
} from './icons';

type DashboardShellProps = {
  children: ReactNode;
  currentSection: 'agents' | 'business' | 'conversations' | 'overview';
  email: string | null;
  membershipRole: string | null;
  tenantName: string | null;
};

type SidebarItem = {
  href?: string;
  icon: ReactNode;
  kind: 'link' | 'placeholder';
  label: string;
  section: DashboardShellProps['currentSection'];
};

const sidebarItems: SidebarItem[] = [
  {
    href: '/dashboard',
    icon: <OverviewIcon />,
    kind: 'link',
    label: 'Overview',
    section: 'overview',
  },
  {
    href: '/dashboard/business',
    icon: <BusinessIcon />,
    kind: 'link',
    label: 'Business Configuration',
    section: 'business',
  },
  {
    icon: <AgentsIcon />,
    kind: 'placeholder',
    label: 'Agents',
    section: 'agents',
  },
  {
    icon: <ConversationsIcon />,
    kind: 'placeholder',
    label: 'Conversations',
    section: 'conversations',
  },
];

export function DashboardShell({
  children,
  currentSection,
  email,
  membershipRole,
  tenantName,
}: DashboardShellProps) {
  return (
    <div className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <div className="brand-block">
          <span className="brand-mark">
            <RelayIcon />
          </span>
          <div className="brand-name">Sleek Relay</div>
          <div className="brand-subtitle">
            Browser validation demo workspace
          </div>
        </div>

        <div className="sidebar-group">
          <div className="sidebar-group-title">Workspace</div>
          <nav aria-label="Primary" className="sidebar-nav">
            {sidebarItems.map((item) =>
              item.kind === 'link' ? (
                <Link
                  key={item.label}
                  className={
                    item.section === currentSection
                      ? 'sidebar-link sidebar-link-active'
                      : 'sidebar-link'
                  }
                  href={item.href ?? '/dashboard'}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </Link>
              ) : (
                <div
                  key={item.label}
                  aria-disabled="true"
                  className="sidebar-placeholder"
                >
                  {item.icon}
                  <span>{item.label}</span>
                </div>
              ),
            )}
          </nav>
        </div>
      </aside>

      <div className="dashboard-main">
        <header className="dashboard-header">
          <div className="header-copy">
            <h1 className="header-title">Portal workspace</h1>
            <p className="header-subtitle">
              Authenticated tenant-aware dashboard foundation
            </p>
          </div>

          <div className="header-meta">
            <div className="header-chip">
              <ShieldIcon />
              <span>
                {membershipRole ? `${membershipRole} access` : 'No membership'}
              </span>
            </div>
            <div className="header-chip">
              <BuildingIcon />
              <span>{tenantName ?? 'No tenant assigned'}</span>
            </div>
            <div className="header-chip">
              <ClockIcon />
              <span>{email ?? 'No active session'}</span>
            </div>
          </div>
        </header>

        <main className="dashboard-content">{children}</main>
      </div>
    </div>
  );
}
