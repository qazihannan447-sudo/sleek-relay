import Link from 'next/link';
import type { ReactNode } from 'react';

import {
  AgentsIcon,
  BusinessIcon,
  CapturesIcon,
  ChevronLeftIcon,
  ConversationsIcon,
  OverviewIcon,
  UsageIcon,
} from './icons';
import { AccountMenu } from './account-menu';

type DashboardShellProps = {
  children: ReactNode;
  currentSection:
    | 'agents'
    | 'business'
    | 'captures'
    | 'conversations'
    | 'knowledge'
    | 'overview'
    | 'usage';
  email: string | null;
  membershipRole: string | null;
  tenantName: string | null;
};

type SidebarItem = {
  icon: ReactNode;
  href: string;
  label: string;
  section: DashboardShellProps['currentSection'];
};

const sidebarItems: SidebarItem[] = [
  {
    href: '/dashboard',
    icon: <OverviewIcon />,
    label: 'Overview',
    section: 'overview',
  },
  {
    href: '/dashboard/business',
    icon: <BusinessIcon />,
    label: 'Business Configuration',
    section: 'business',
  },
  {
    href: '/dashboard/agents',
    icon: <AgentsIcon />,
    label: 'Agents',
    section: 'agents',
  },
  {
    href: '/dashboard/conversations',
    icon: <ConversationsIcon />,
    label: 'Conversations',
    section: 'conversations',
  },
  {
    href: '/dashboard/captures',
    icon: <CapturesIcon />,
    label: 'Captures',
    section: 'captures',
  },
  {
    href: '/dashboard/usage',
    icon: <UsageIcon />,
    label: 'Usage',
    section: 'usage',
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
    <div className="dashboard-shell-frame">
      <input
        aria-label="Collapse sidebar"
        className="sidebar-toggle-input"
        id="dashboard-sidebar-toggle"
        type="checkbox"
      />

      <div className="dashboard-shell">
        <aside className="dashboard-sidebar">
          <div className="sidebar-topbar">
            <Link className="brand-lockup" href="/dashboard" prefetch={true}>
              <span className="brand-name">Sleek Relay</span>
            </Link>
            <label
              className="sidebar-toggle-button sidebar-toggle-button-desktop"
              htmlFor="dashboard-sidebar-toggle"
            >
              <span className="sidebar-toggle-open-icon">
                <ChevronLeftIcon />
              </span>
              <span className="sidebar-toggle-collapsed-icon">
                <ChevronLeftIcon />
              </span>
            </label>
          </div>

          <div className="sidebar-group">
            <nav aria-label="Primary" className="sidebar-nav">
              {sidebarItems.map((item) => (
                <Link
                  key={item.label}
                  className={
                    item.section === currentSection
                      ? 'sidebar-link sidebar-link-active'
                      : 'sidebar-link'
                  }
                  href={item.href}
                  prefetch={true}
                  title={item.label}
                >
                  {item.icon}
                  <span className="sidebar-link-label">{item.label}</span>
                </Link>
              ))}
            </nav>
          </div>

          <div className="sidebar-footer">
            <AccountMenu
              email={email}
              membershipRole={membershipRole}
              tenantName={tenantName}
            />
          </div>
        </aside>

        <div className="dashboard-main">
          <div className="dashboard-mobile-bar">
            <label
              className="sidebar-toggle-button sidebar-toggle-button-mobile"
              htmlFor="dashboard-sidebar-toggle"
            >
              <span className="sidebar-toggle-open-icon">
                <ChevronLeftIcon />
              </span>
              <span className="sidebar-toggle-collapsed-icon">
                <ChevronLeftIcon />
              </span>
            </label>
          </div>

          <main className="dashboard-content">{children}</main>
        </div>
      </div>
    </div>
  );
}
