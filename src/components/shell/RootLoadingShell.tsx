import { LoadingState, Skeleton } from "@/components/ui/Skeleton";

export function RootLoadingShell() {
  return (
    <LoadingState
      label="Loading Solesneakers"
      className="min-h-screen bg-[var(--storefront-surface)]"
    >
      <div className="flex h-20 items-center justify-between border-b border-zinc-200 px-5 sm:h-24 sm:px-8">
        <Skeleton className="h-7 w-7" />
        <Skeleton className="h-12 w-20 sm:h-16 sm:w-24" />
        <Skeleton className="h-7 w-7" />
      </div>
      <div className="mx-auto max-w-[90rem] px-5 py-12 sm:px-8">
        <Skeleton className="mx-auto h-8 w-48" />
        <Skeleton className="mt-10 h-[min(48vh,28rem)] w-full" />
      </div>
    </LoadingState>
  );
}
