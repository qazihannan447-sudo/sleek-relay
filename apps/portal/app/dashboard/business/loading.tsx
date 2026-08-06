import { DashboardLoading } from '../../../components/dashboard-loading';

export default function BusinessConfigurationLoading() {
  return (
    <DashboardLoading
      currentSection="business"
      layout="business"
      showHeader={false}
    />
  );
}
