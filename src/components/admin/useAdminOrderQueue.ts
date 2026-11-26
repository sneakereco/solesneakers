"use client";
import { useSession } from "@/contexts/SessionContext";
import { useCallback, useState } from "react";
import { fetchJsonWithDeadline } from "@/lib/http/request-deadline";
import { useAdminRead } from "./useAdminRead";

const emptyOrders: never[] = [];
export function useAdminOrderQueue<Order, Tab extends { key: string }>(
  tabs: readonly Tab[],
  params: (tab: Tab, page: number, limit: number) => URLSearchParams,
  activeTab: Tab["key"],
  page: number,
  pageSize: number,
) {
  const { user, role } = useSession();
  const [accessRevision, recheckAccess] = useState(0);
  const owner = JSON.stringify([user?.id, role, accessRevision]);
  const tab = tabs.find((entry) => entry.key === activeTab) ?? tabs[0];
  const url = "/api/admin/orders?" + params(tab, page, pageSize);
  const loadOrders = useCallback(
    async (signal: AbortSignal) => {
      const result = await fetchJsonWithDeadline<{ orders: Order[]; count: number }>(
        url,
        "Orders unavailable",
        signal,
      );
      if (!Array.isArray(result.orders) || !Number.isFinite(result.count))
        throw new Error("Invalid order list");
      return { ...result, page };
    },
    [url, page],
  );
  const loadCounts = useCallback(
    async (signal: AbortSignal) => {
      const counts: Partial<Record<Tab["key"], number>> = {};
      await Promise.all(
        tabs.map(async (entry) => {
          const data = await fetchJsonWithDeadline<{ count: number }>(
            "/api/admin/orders?" + params(entry, 1, 1),
            "Count unavailable",
            signal,
          );
          if (!Number.isFinite(data.count)) throw new Error("Invalid order count");
          counts[entry.key as Tab["key"]] = data.count;
        }),
      );
      return counts;
    },
    [tabs, params],
  );
  const listRead = useAdminRead(
    loadOrders,
    "orders",
    JSON.stringify([owner, params(tab, 1, pageSize).toString()]),
  );
  const countRead = useAdminRead(loadCounts, "queue counts", owner);
  const [deniedScope, setDeniedScope] = useState<string>();
  if ((listRead.denied || countRead.denied) && deniedScope !== owner)
    setDeniedScope(owner);
  const denied = deniedScope === owner || listRead.denied || countRead.denied;
  const list = denied
    ? {
        ...listRead,
        data: undefined,
        denied: true,
        error: "Admin access could not be verified.",
        retry: () => recheckAccess((n) => n + 1),
      }
    : listRead;
  const displayedPage = list.data?.page;
  const retained = displayedPage !== undefined && displayedPage !== page;
  const showing = retained ? "Showing page " + displayedPage + "." : "";
  return {
    list: retained && list.error ? { ...list, error: list.error + " " + showing } : list,
    listLabel: retained ? showing + " Loading page " + page : "Loading orders",
    displayedPage,
    totals: denied ? { ...countRead, data: undefined, retry: list.retry } : countRead,
    orders: list.data?.orders ?? emptyOrders,
    counts: denied ? undefined : countRead.data,
    totalPages: Math.max(1, Math.ceil((list.data?.count ?? 0) / pageSize)),
  };
}
