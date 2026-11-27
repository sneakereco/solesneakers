"use client";

export default function AnalyticsError({ retry }: { retry: () => void }) {
  return (
    <div data-admin-page className="analytics-page">
      <div data-admin-page-header>
        <h1>Analytics</h1>
      </div>
      <div role="alert" className="analytics-alert">
        <p>Analytics reporting is temporarily unavailable.</p>
        <button type="button" className="admin-button-secondary" onClick={retry}>
          Retry report
        </button>
      </div>
    </div>
  );
}
