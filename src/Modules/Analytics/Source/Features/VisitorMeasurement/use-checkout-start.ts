"use client";
import { useEffect, useRef, useState } from "react";
import { useSession } from "@/contexts/SessionContext";
import { readCheckoutReceipt } from "./consent";
import { captureCheckoutStarted } from "./triggers";
import { useCheckoutMeasurement, useViewGrant } from "./view-grant";

export function useCheckoutStart(
  usable: boolean,
  cartKey: string | null,
  isCurrent: () => boolean,
): void {
  const { user, status, sessionMutationRevision } = useSession();
  const accountId = user?.id ?? null;
  const phase = useCheckoutMeasurement();
  const activeReceipt = useViewGrant();
  const finished = useRef(false);
  const read = useRef<{
    cartKey: string;
    accountId: string | null;
    startedAt: number;
    sessionMutationRevision: number;
    controller: AbortController;
  } | null>(null);
  const [receipt, setReceipt] = useState<string | null | undefined>(undefined);

  useEffect(
    () => () => {
      read.current?.controller.abort();
      read.current = null;
    },
    [],
  );

  useEffect(() => {
    if (finished.current) return;
    const pending = read.current;
    if (
      pending &&
      (pending.sessionMutationRevision !== sessionMutationRevision ||
        performance.now() - pending.startedAt > 30_000 ||
        (status === "ready" &&
          (pending.accountId !== accountId ||
            (cartKey !== null && pending.cartKey !== cartKey))))
    ) {
      finished.current = true;
      pending.controller.abort();
      return;
    }
    if (status !== "ready" || !usable || cartKey === null || !isCurrent()) return;
    if (phase === "off") {
      finished.current = true;
      pending?.controller.abort();
      return;
    }
    if (phase === "hydrating") {
      if (pending) return;
      // This request carries the grant cookie at the first usable checkout.
      // A later preference refresh can only release this same grant and cart.
      const controller = new AbortController();
      const entry = {
        cartKey,
        accountId,
        startedAt: performance.now(),
        sessionMutationRevision,
        controller,
      };
      read.current = entry;
      const timeout = window.setTimeout(() => controller.abort(), 5000);
      void readCheckoutReceipt(controller.signal)
        .then((value) => {
          if (read.current === entry && !finished.current) setReceipt(value);
        })
        .finally(() => window.clearTimeout(timeout));
      return;
    }
    if (pending && receipt === undefined) return;
    finished.current = true;
    if (activeReceipt && (!pending || receipt === activeReceipt))
      captureCheckoutStarted();
  }, [
    usable,
    cartKey,
    accountId,
    phase,
    activeReceipt,
    receipt,
    isCurrent,
    status,
    sessionMutationRevision,
  ]);
}
