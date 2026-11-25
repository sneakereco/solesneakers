"use client";

import {
  createContext,
  useContext,
  useLayoutEffect,
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
  const [lastResults, setLastResults] = useState({ children, query: committedQuery });

  if (
    !loadFailed &&
    (children !== lastResults.children || committedQuery !== lastResults.query)
  ) {
    setLastResults({ children, query: committedQuery });
  }

  const visibleQuery = loadFailed ? lastResults.query : committedQuery;
  const [intendedQuery, setIntendedQuery] = useOptimistic(visibleQuery);

  useLayoutEffect(() => {
    if (!isPending) requestedQuery.current = null;
  }, [committedQuery, isPending]);

  const beginNavigation = (query: string, navigate: () => void) => {
    requestedQuery.current = query;
    startTransition(() => {
      setIntendedQuery(query);
      navigate();
    });
  };

  const updateQuery: StoreNavigationValue["updateQuery"] = (update, scroll = false) => {
    // A new action can build on the shopper's previous intent before its route commits.
    const current = requestedQuery.current ?? visibleQuery;
    const params = new URLSearchParams(current);
    update(params);
    const next = params.toString();
    if (next === current) return;

    beginNavigation(next, () =>
      router.push(next ? `/store?${next}` : "/store", { scroll }),
    );
  };

  return (
    <CatalogNavigationContext.Provider value={{ isPending, intendedQuery, updateQuery }}>
      {isPending && <LoadingAnnouncement label="Updating products" />}
      {loadFailed && (
        <div className="mx-auto max-w-[90rem] px-5 py-5 sm:px-8">
          <RequestError
            message={
              lastResults.children
                ? "Could not update products. Showing previous results."
                : "Could not load products."
            }
            onRetry={() => beginNavigation(committedQuery, () => router.refresh())}
            retrying={isPending}
          />
        </div>
      )}
      {loadFailed ? lastResults.children : children}
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
