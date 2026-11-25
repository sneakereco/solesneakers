"use client";

import {
  createContext,
  useContext,
  useEffect,
  useOptimistic,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { LoadingAnnouncement } from "@/components/ui/LoadingAnnouncement";
import { RequestError } from "@/components/ui/RequestError";

type StoreNavigationValue = {
  isPending: boolean;
  intendedQuery: string;
  updateQuery: (update: (params: URLSearchParams) => void, scroll?: boolean) => void;
};

const CatalogNavigationContext = createContext<StoreNavigationValue | null>(null);

export function StoreNavigation({
  children,
  loadFailed = false,
}: {
  children?: ReactNode;
  loadFailed?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const committedQuery = searchParams.toString();
  const requestedQuery = useRef<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [intendedQuery, setIntendedQuery] = useOptimistic(committedQuery);
  const [lastResults, setLastResults] = useState(children);

  if (!loadFailed && children !== lastResults) setLastResults(children);

  useEffect(() => {
    if (!isPending) requestedQuery.current = null;
  }, [committedQuery, isPending]);

  const updateQuery: StoreNavigationValue["updateQuery"] = (update, scroll = false) => {
    // A new action can build on the shopper's previous intent before its route commits.
    const current = requestedQuery.current ?? committedQuery;
    const params = new URLSearchParams(current);
    update(params);
    const next = params.toString();
    if (next === current) return;

    requestedQuery.current = next;
    startTransition(() => {
      setIntendedQuery(next);
      router.push(next ? `/store?${next}` : "/store", { scroll });
    });
  };

  return (
    <CatalogNavigationContext.Provider value={{ isPending, intendedQuery, updateQuery }}>
      {isPending && <LoadingAnnouncement label="Updating products" />}
      {loadFailed && (
        <div className="mx-auto max-w-[90rem] px-5 py-5 sm:px-8">
          <RequestError
            message={
              lastResults
                ? "Could not update products. Showing previous results."
                : "Could not load products."
            }
            onRetry={() => startTransition(() => router.refresh())}
            retrying={isPending}
          />
        </div>
      )}
      {loadFailed ? lastResults : children}
    </CatalogNavigationContext.Provider>
  );
}

export function useStoreNavigation() {
  const navigation = useContext(CatalogNavigationContext);
  if (!navigation) throw new Error("Store navigation requires StoreNavigation");
  return navigation;
}

export function StoreResults({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const { isPending } = useStoreNavigation();
  return (
    <section
      aria-label="Products"
      aria-busy={isPending || undefined}
      className={`relative ${className ?? ""}`}
    >
      {isPending && (
        <p
          aria-hidden="true"
          className="absolute inset-x-3 top-2 truncate text-center text-sm text-zinc-600"
        >
          Updating products…
        </p>
      )}
      {children}
    </section>
  );
}
