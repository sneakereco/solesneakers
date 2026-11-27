import { LoadingState, Skeleton } from "@/components/ui/Skeleton";

function CartLineSkeleton({ drawer = false }: { drawer?: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={
        drawer
          ? "grid grid-cols-[6rem_minmax(0,1fr)] gap-4 border-b border-zinc-200 py-6"
          : "grid grid-cols-[7rem_minmax(0,1fr)] gap-5 border-b border-zinc-300 py-7 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-8"
      }
    >
      <Skeleton className={drawer ? "h-28 w-full" : "h-32 w-full sm:h-44"} />
      <div className="flex min-w-0 flex-col">
        <Skeleton className="h-5 w-4/5 max-w-56" />
        <Skeleton className="mt-3 h-4 w-16" />
        <Skeleton className="mt-auto h-10 w-24" />
      </div>
    </div>
  );
}

export function CartSkeleton({ drawer = false }: { drawer?: boolean }) {
  if (drawer) {
    return (
      <LoadingState label="Loading your cart" className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-zinc-200 bg-zinc-50 px-5 py-4">
          <Skeleton className="h-10 w-4/5 max-w-56" />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden px-5 py-3 sm:px-6">
          <CartLineSkeleton drawer />
          <CartLineSkeleton drawer />
        </div>
        <div className="shrink-0 border-t border-zinc-200 px-5 pb-6 pt-5 sm:px-6">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="mt-5 h-12 w-full" />
        </div>
      </LoadingState>
    );
  }

  return (
    <LoadingState
      label="Loading your cart"
      className="min-h-screen bg-[var(--storefront-surface)] px-5 pb-24 pt-12 sm:px-8 lg:px-12"
    >
      <Skeleton className="mx-auto h-9 w-48" />
      <div className="mx-auto mt-14 grid max-w-[90rem] grid-cols-1 items-start gap-10 lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-14">
        <div className="border-t border-zinc-300">
          <CartLineSkeleton />
          <CartLineSkeleton />
        </div>
        <div className="border border-zinc-300 bg-white p-6">
          <Skeleton className="h-10 w-4/5" />
          <Skeleton className="mt-6 h-6 w-32" />
          <Skeleton className="mt-7 h-5 w-4/5" />
          <Skeleton className="mt-6 h-12 w-full" />
        </div>
      </div>
    </LoadingState>
  );
}
