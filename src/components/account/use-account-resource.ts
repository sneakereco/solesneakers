"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { fetchAccountJson } from "@/lib/account/request";
import { ResponseError } from "@/lib/http/read-json-response";

type ReadError = "sign-in" | "owner-changed" | "unavailable";

export function useAccountResource<T>(
  ownerId: string,
  url: string,
  parse: (response: unknown) => T,
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ReadError | null>(null);
  const active = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    if (active.current) return Promise.resolve();
    const controller = new AbortController();
    active.current = controller;

    return Promise.resolve()
      .then(() =>
        fetchAccountJson<unknown>(
          ownerId,
          url,
          "Account information could not be loaded",
          controller.signal,
        ),
      )
      .then((response) => {
        if (controller.signal.aborted) return;
        const value = parse(response);
        setData(value);
        setError(null);
        return value;
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        const status = failure instanceof ResponseError ? failure.status : null;
        if (status === 401 || status === 409) setData(null);
        setError(
          status === 401 ? "sign-in" : status === 409 ? "owner-changed" : "unavailable",
        );
      })
      .finally(() => {
        if (active.current === controller) {
          active.current = null;
          setLoading(false);
        }
      });
  }, [ownerId, parse, url]);

  useEffect(() => {
    void load();
    return () => {
      active.current?.abort();
      active.current = null;
    };
  }, [load]);

  function retry() {
    active.current?.abort();
    active.current = null;
    setLoading(true);
    return load();
  }

  function replace(value: T) {
    active.current?.abort();
    active.current = null;
    setData(value);
    setLoading(false);
    setError(null);
  }

  return { data, loading, error, load: retry, replace };
}
