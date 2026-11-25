import type { ReactNode } from "react";

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
      <span role="status" className="sr-only">
        {label}
      </span>
      <div aria-busy="true" className={className}>
        {children}
      </div>
    </>
  );
}
