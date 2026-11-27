import type { ReactNode } from "react";

import { LoadingAnnouncement } from "./LoadingAnnouncement";

export function Skeleton({ className }: { className?: string }) {
  return <div data-ui-skeleton aria-hidden="true" className={className} />;
}

type LoadingStateProps = {
  label: string;
  children: ReactNode;
  className?: string;
};

export function LoadingState({ label, children, className }: LoadingStateProps) {
  return (
    <>
      <LoadingAnnouncement label={label} />
      <div aria-busy="true" className={className}>
        {children}
      </div>
    </>
  );
}
