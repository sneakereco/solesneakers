import { LoadingState, Skeleton } from "@/components/ui/Skeleton";

export const productGridClassName =
  "grid grid-cols-2 gap-x-2 gap-y-10 sm:grid-cols-3 lg:grid-cols-4 lg:gap-x-4 lg:gap-y-14";
export const featuredCardClassName =
  "w-[78%] shrink-0 sm:w-[calc((100%-1.5rem)/2)] md:w-[calc((100%-3rem)/3)] lg:w-[calc((100%-6rem)/4)]";

export const clothingFeaturedCardClassName =
  "w-full shrink-0 sm:w-[calc((100%-1.5rem)/2)] md:w-[calc((100%-3rem)/3)] lg:w-[calc((100%-6rem)/4)]";

export function FeaturedCardsSkeleton({
  label,
  clothing = false,
}: {
  label: string;
  clothing?: boolean;
}) {
  return (
    <LoadingState label={label} className="mt-10 overflow-hidden md:mt-14">
      <div className="flex gap-4 px-1 pb-2 sm:gap-6 lg:gap-8" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className={clothing ? clothingFeaturedCardClassName : featuredCardClassName}
          >
            <Skeleton className="h-48 w-full sm:h-52 md:h-56" />
            <div className="mt-5 h-10">
              <Skeleton className="mx-auto h-3 w-3/5" />
            </div>
            <Skeleton className="mx-auto mt-1 h-5 w-16" />
          </div>
        ))}
      </div>
    </LoadingState>
  );
}

export function StoreSkeleton() {
  return (
    <LoadingState
      label="Loading products"
      className="min-h-screen bg-[var(--storefront-surface)]"
    >
      <div className="min-h-[190px] border-b border-zinc-300 px-5 pt-6 sm:px-8 lg:px-12">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="mx-auto mt-10 h-9 w-44" />
      </div>
      <div className="flex min-h-14 items-center justify-between border-y border-zinc-300 px-5 sm:px-8 lg:px-12">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="flex min-h-[72px] flex-wrap items-center gap-6 border-b border-zinc-300 px-5 sm:px-8 lg:px-12">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-4 w-12" />
        ))}
      </div>
      <div
        className={`${productGridClassName} px-3 py-12 sm:px-6 lg:px-10 lg:py-16`}
        aria-hidden="true"
      >
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index}>
            <Skeleton className="aspect-[1/1.02] h-auto" />
            <div className="px-2 pb-3 pt-4">
              <div className="h-10">
                <Skeleton className="mx-auto h-3 w-4/5" />
              </div>
              <Skeleton className="mx-auto mt-1 h-4 w-12" />
            </div>
          </div>
        ))}
      </div>
    </LoadingState>
  );
}

export function ProductDetailSkeleton() {
  return (
    <LoadingState
      label="Loading product details"
      className="min-h-screen bg-[var(--storefront-surface)]"
    >
      <div className="mx-auto grid max-w-[120rem] grid-cols-1 items-start lg:min-h-[42rem] lg:grid-cols-[minmax(0,1.75fr)_minmax(24rem,0.9fr)]">
        <div className="flex min-w-0 flex-col gap-4 px-5 pb-8 pt-5 sm:px-8 lg:flex-row lg:gap-6 lg:px-5 lg:py-5 xl:gap-8">
          <div className="order-2 flex gap-3 pb-1 lg:order-1 lg:w-[4.5rem] lg:flex-col lg:pb-0">
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className="h-16 w-16 lg:h-[4.5rem] lg:w-[4.5rem]" />
            ))}
          </div>
          <Skeleton className="order-1 aspect-square h-auto flex-1 lg:order-2 lg:aspect-auto lg:min-h-[39rem]" />
        </div>
        <div className="border-t border-zinc-200 px-6 py-10 sm:px-10 lg:border-l lg:border-t-0 lg:px-8 lg:py-8 xl:px-10">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-3 h-9 w-5/6" />
          <Skeleton className="mt-4 h-7 w-20" />
          <Skeleton className="mt-10 h-5 w-12" />
          <div className="mt-3 flex gap-2.5">
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className="h-[3.25rem] w-[3.25rem]" />
            ))}
          </div>
          <Skeleton className="mt-6 h-5 w-24" />
          <Skeleton className="mt-3 h-[3.25rem] w-20" />
          <Skeleton className="mt-7 h-[3.25rem] w-full" />
        </div>
      </div>
    </LoadingState>
  );
}
