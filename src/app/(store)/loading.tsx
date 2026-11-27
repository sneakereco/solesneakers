import { LoadingState, Skeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <LoadingState
      label="Loading storefront page"
      className="min-h-screen bg-[var(--storefront-surface)]"
    >
      <div className="mx-auto max-w-5xl px-5 py-12 sm:px-8">
        <Skeleton className="mx-auto h-9 w-48" />
        <Skeleton className="mt-10 h-[min(40vh,22rem)] w-full" />
      </div>
    </LoadingState>
  );
}
