import { DashboardLoading } from '../../components/dashboard-loading';

export default function DashboardOverviewLoading() {
  return (
    <DashboardLoading
      currentSection="overview"
      layout="overview"
      showHeader={false}
    />
  );
}
