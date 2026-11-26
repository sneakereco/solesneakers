"use client";
import { useCallback, useEffect, useState } from "react";
import { ResponseError } from "@/lib/http/read-json-response";

type Snapshot<T> = {
  load: (signal: AbortSignal) => Promise<T>;
  revision: number;
  data?: T;
  error?: string;
  denied?: boolean;
};
export function useAdminRead<T>(
  load: (signal: AbortSignal) => Promise<T>,
  label: string,
) {
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot<T>>();
  const retry = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setSnapshot({ load, revision, data });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        const status = reason instanceof ResponseError ? reason.status : 0;
        const denied = status === 401 || status === 403;
        const error = denied
          ? "Admin access could not be verified."
          : status === 429
            ? "Too many requests. Wait a moment and retry."
            : `Unable to load ${label}.`;
        setSnapshot((old) => ({
          load,
          revision,
          error,
          denied,
          data: !denied && old?.load === load ? old.data : undefined,
        }));
      });
    return () => controller.abort();
  }, [load, label, revision]);
  const current = snapshot?.load === load ? snapshot : undefined;
  return {
    data: current?.data,
    error: current?.error,
    denied: current?.denied,
    pending: current?.revision !== revision,
    retry,
  };
}
