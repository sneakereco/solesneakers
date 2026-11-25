import { LoadingState, Skeleton } from "@/components/ui/Skeleton";

export function ShippingProfileSkeleton() {
  return (
    <LoadingState label="Loading shipping profile" className="mt-4 space-y-3">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-4 w-52 max-w-full" />
      <Skeleton className="h-4 w-32" />
    </LoadingState>
  );
}

export function AddressesSkeleton() {
  return (
    <LoadingState
      label="Loading addresses"
      className="mt-5 grid border-t border-zinc-300 md:grid-cols-2"
    >
      {[0, 1].map((index) => (
        <div key={index} className="space-y-3 border-b border-zinc-300 py-6 md:pr-6">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-4 w-48 max-w-full" />
          <Skeleton className="h-4 w-28" />
        </div>
      ))}
    </LoadingState>
  );
}

export function OrdersSkeleton() {
  return (
    <LoadingState
      label="Loading orders"
      className="mt-8 space-y-5 border-y border-zinc-300 py-7"
    >
      <div className="flex justify-between gap-4">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-5 w-16" />
      </div>
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-4 w-48 max-w-full" />
    </LoadingState>
  );
}

export function AccountSkeleton() {
  return (
    <div className="min-h-screen bg-[var(--storefront-surface)] text-black">
      <div className="mx-auto max-w-[92rem] px-5 pb-24 pt-12 sm:px-8 sm:pt-16 lg:px-12">
        <LoadingState label="Loading account">
          <div className="flex flex-col gap-4 border-b border-zinc-300 pb-8 sm:flex-row sm:items-end sm:justify-between">
            <Skeleton className="h-10 w-52 sm:h-14 sm:w-72" />
            <Skeleton className="h-5 w-44" />
          </div>
          <div className="grid gap-8 pt-8 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-20 lg:pt-12">
            <div className="flex gap-3 lg:flex-col lg:gap-5">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-20" />
            </div>
            <div className="space-y-6">
              <Skeleton className="h-9 w-60 max-w-full" />
              <div className="space-y-4 border-y border-zinc-300 py-6">
                <Skeleton className="h-4 w-44" />
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-4 w-48" />
              </div>
              <Skeleton className="h-7 w-40" />
              <Skeleton className="h-32 w-full" />
            </div>
          </div>
        </LoadingState>
      </div>
    </div>
  );
}
