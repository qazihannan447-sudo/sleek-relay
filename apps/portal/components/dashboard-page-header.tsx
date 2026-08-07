import type { ReactNode } from 'react';

type DashboardPageHeaderProps = {
  action?: ReactNode;
  eyebrow?: string;
  title: string;
  subtitle: string;
};

export function DashboardPageHeader({
  action,
  title,
  subtitle,
}: DashboardPageHeaderProps) {
  return (
    <div className="page-header">
      <div className="page-header-top">
        <h1 className="page-title">{title}</h1>
        {action ? <div className="page-header-actions">{action}</div> : null}
      </div>
      <p className="page-subtitle">{subtitle}</p>
    </div>
  );
}
