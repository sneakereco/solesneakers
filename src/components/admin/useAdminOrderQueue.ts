"use client";
import { useSession } from "@/contexts/SessionContext";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { fetchJsonWithDeadline } from "@/lib/http/request-deadline";
import { ResponseError } from "@/lib/http/read-json-response";
import { useAdminRead } from "./useAdminRead";

export type QueueAccess = {
  writable: boolean;
  isCurrent(): boolean;
  canCommand(): boolean;
};

const emptyOrders: never[] = [];
export function useAdminOrderQueue<Order, Tab extends { key: string }>(
  tabs: readonly Tab[],
  params: (tab: Tab, page: number, limit: number) => URLSearchParams,
  activeTab: Tab["key"],
  page: number,
  pageSize: number,
) {
  const { user, role, isLoading, isSessionUnavailable, isIdentityCurrent } = useSession();
  const [accessRevision, recheckAccess] = useState(0);
  const userId = user?.id ?? null;
  const owner = useMemo(
    () => ({ userId, role, accessRevision }),
    [userId, role, accessRevision],
  );
  const tab = tabs.find((entry) => entry.key === activeTab) ?? tabs[0];
  const url = "/api/admin/orders?" + params(tab, page, pageSize);
  const scope = useMemo(() => ({ owner, url }), [owner, url]);
  const active = useRef<{ scope: typeof scope; writable: boolean } | null>(null);
  const revoked = useRef<typeof owner | null>(null);
  const [deniedOwner, setDeniedOwner] = useState<typeof owner | null>(null);
  const recordFailure = useCallback(
    (error: unknown, signal: AbortSignal): never => {
      if (
        !signal.aborted &&
        active.current?.scope.owner === owner &&
        error instanceof ResponseError &&
        (error.status === 401 || error.status === 403)
      ) {
        // Invalidate captured callbacks before the denial render removes the dialogs.
        revoked.current = owner;
        setDeniedOwner(owner);
      }
      throw error;
    },
    [owner],
  );
  const loadOrders = useCallback(
    async (signal: AbortSignal) => {
      const result = await fetchJsonWithDeadline<{ orders: Order[]; count: number }>(
        url,
        "Orders unavailable",
        signal,
      ).catch((error: unknown) => recordFailure(error, signal));
      if (!Array.isArray(result.orders) || !Number.isFinite(result.count))
        throw new Error("Invalid order list");
      return { ...result, page };
    },
    [url, page, recordFailure],
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
          ).catch((error: unknown) => recordFailure(error, signal));
          if (!Number.isFinite(data.count)) throw new Error("Invalid order count");
          counts[entry.key as Tab["key"]] = data.count;
        }),
      );
      return counts;
    },
    [tabs, params, recordFailure],
  );
  const listRead = useAdminRead(
    loadOrders,
    "orders",
    JSON.stringify([owner, params(tab, 1, pageSize).toString()]),
  );
  const countRead = useAdminRead(loadCounts, "queue counts", owner);
  const denied = deniedOwner === owner || listRead.denied || countRead.denied;
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
  const writable = !denied && !!list.data && !list.pending && !list.error && !retained;
  useLayoutEffect(() => {
    active.current = { scope, writable };
    return () => {
      active.current = null;
    };
  }, [scope, writable]);
  const ownerAvailable = !denied && !isLoading && !isSessionUnavailable;
  const isOwnerCurrent = () =>
    active.current?.scope.owner === owner &&
    revoked.current !== owner &&
    !denied &&
    isIdentityCurrent(userId);
  const isCurrent = () => active.current?.scope === scope && isOwnerCurrent();
  const access: QueueAccess = {
    writable,
    isCurrent,
    canCommand: () => isCurrent() && active.current?.writable === true,
  };
  return {
    ownerAccess: { scope: owner, available: ownerAvailable, isCurrent: isOwnerCurrent },
    selectionScope: denied ? null : scope,
    access,
    list: retained && list.error ? { ...list, error: list.error + " " + showing } : list,
    listLabel: retained ? showing + " Loading page " + page : "Loading orders",
    displayedPage,
    totals: denied ? { ...countRead, data: undefined, retry: list.retry } : countRead,
    orders: list.data?.orders ?? emptyOrders,
    counts: denied ? undefined : countRead.data,
    totalPages: Math.max(1, Math.ceil((list.data?.count ?? 0) / pageSize)),
  };
}
