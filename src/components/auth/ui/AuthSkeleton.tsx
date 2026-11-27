import { LoadingState, Skeleton } from "@/components/ui/Skeleton";

export function AuthSkeleton() {
  return (
    <LoadingState label="Loading authentication" className="space-y-5">
      <div className="space-y-3">
        <Skeleton className="h-9 w-48 max-w-full" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="space-y-4">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-14 w-full" />
      </div>
      <Skeleton className="h-14 w-full" />
    </LoadingState>
  );
}
