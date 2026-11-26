"use client";
import { useCallback } from "react";
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
      return result;
    },
    [url],
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
  const list = useAdminRead(loadOrders, "orders");
  const totals = useAdminRead(loadCounts, "queue counts");
  return {
    list,
    totals,
    orders: list.data?.orders ?? emptyOrders,
    counts: totals.data,
    totalPages: Math.max(1, Math.ceil((list.data?.count ?? 0) / pageSize)),
  };
}
