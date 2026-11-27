import { ReportSkeleton } from "@/Modules/Analytics/Source/Features/Dashboard/ReportSkeleton";

export default function AnalyticsLoading() {
  return (
    <div data-admin-page className="analytics-page">
      <div data-admin-page-header>
        <h1>Analytics</h1>
      </div>
      <ReportSkeleton />
    </div>
  );
}
