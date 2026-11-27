import { LoadingState, Skeleton } from "@/components/ui/Skeleton";

function FieldShapes() {
  return (
    <div className="grid gap-3">
      <Skeleton className="h-6 w-24 rounded" />
      <Skeleton className="h-12 rounded" />
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-12 rounded" />
        <Skeleton className="h-12 rounded" />
      </div>
    </div>
  );
}

export function CheckoutSkeleton() {
  return (
    <LoadingState
      label="Loading checkout"
      className="mx-auto grid max-w-5xl gap-12 px-5 py-12 lg:grid-cols-2"
    >
      <div className="space-y-10">
        <FieldShapes />
        <FieldShapes />
      </div>
      <div className="space-y-5">
        <Skeleton className="h-20 rounded" />
        <Skeleton className="h-12 rounded" />
      </div>
    </LoadingState>
  );
}

export function OrderStatusSkeleton() {
  return (
    <LoadingState
      label="Loading order status"
      className="mx-auto max-w-4xl space-y-8 px-4 py-10"
    >
      <Skeleton className="h-8 w-48 rounded" />
      <div className="grid gap-6 md:grid-cols-3">
        <Skeleton className="h-64 rounded md:col-span-2" />
        <Skeleton className="h-40 rounded" />
      </div>
    </LoadingState>
  );
}

export function CardFieldsSkeleton() {
  return (
    <LoadingState label="Loading secure card fields">
      <Skeleton className="h-20 rounded-xl" />
    </LoadingState>
  );
}
