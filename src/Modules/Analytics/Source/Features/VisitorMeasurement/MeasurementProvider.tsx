"use client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { useSession } from "@/contexts/SessionContext";
import { isAdminRole } from "@/config/constants/roles";
import { configuredMeasurement, isApprovedMeasurementHostname } from "./host-gate";
import { getAnalyticsConsent, setAnalyticsConsent } from "./consent";
import {
  capture,
  getCheckoutTrackingContext,
  initializeMeasurement,
  identifyConsentingCustomer,
  revokeMeasurement,
  setMeasurementAccount,
} from "./client";
import { safePathname, type ConsentState } from "./contract";
import { withdrawalKey } from "./preference-marker";
import { ConsentBanner } from "./ConsentBanner";
import { ViewGrant } from "./view-grant";

const config = configuredMeasurement();
export function MeasurementProvider({ children }: { children: ReactNode }) {
  const { user, role, isLoading } = useSession();
  const userId = user?.id ?? null;
  const pathname = usePathname();
  const allowed = Boolean(
    config &&
      typeof window !== "undefined" &&
      isApprovedMeasurementHostname(window.location.hostname, config.environment) &&
      safePathname(pathname) &&
      !(role && isAdminRole(role)),
  );
  const [state, setState] = useState<ConsentState | null>(null);
  const [verified, setVerified] = useState<{
    receiptId: string;
    accountId: string | null;
  } | null>(null);
  const grant =
    allowed &&
    !isLoading &&
    state?.choice === "accepted" &&
    verified?.receiptId === state.receiptId &&
    verified.accountId === userId
      ? verified.receiptId
      : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const sequence = useRef(0);
  const invalidateRequests = useCallback(() => ++sequence.current, []);
  const saving = useRef(false);
  const lastPage = useRef("");
  useLayoutEffect(() => {
    setMeasurementAccount(userId, !allowed || isLoading);
    const block = () => setMeasurementAccount(userId, true);
    window.addEventListener("sessionUpdate", block);
    return () => window.removeEventListener("sessionUpdate", block);
  }, [allowed, isLoading, userId]);
  const refresh = useCallback(() => {
    if (!allowed || saving.current) return;
    const current = invalidateRequests();
    void getAnalyticsConsent().then(
      (next) => {
        if (current === sequence.current)
          setState((prior) =>
            prior?.choice === "accepted" &&
            next.choice === "accepted" &&
            prior.receiptId === next.receiptId
              ? prior
              : next,
          );
      },
      () => {
        if (current === sequence.current) {
          setState(null);
          setVerified(null);
          setMeasurementAccount(userId, true);
        }
      },
    );
  }, [allowed, userId, invalidateRequests]);
  useEffect(() => {
    if (allowed) refresh();
    const stored = (e: StorageEvent) => {
      if (e.key === withdrawalKey) {
        if (e.newValue === "1") {
          revokeMeasurement();
          setVerified(null);
          setState({ choice: "declined", pending: true });
          return;
        }
        refresh();
      }
    };
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", stored);
    return () => {
      invalidateRequests();
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", stored);
    };
  }, [allowed, refresh, invalidateRequests]);
  useEffect(() => {
    if (state?.choice !== "declined" || !state.pending) return;
    const timer = window.setTimeout(refresh, 30000);
    return () => window.clearTimeout(timer);
  }, [state, refresh]);
  useEffect(() => {
    let current = true;
    if (!allowed || isLoading || !state || !config) {
      lastPage.current = "";
      return;
    }
    if (state.choice !== "accepted") {
      revokeMeasurement();
      lastPage.current = "";
      return;
    }
    setMeasurementAccount(userId, false);
    initializeMeasurement(config, state);
    async function measure(receiptId: string) {
      await identifyConsentingCustomer();
      if (!current || !getCheckoutTrackingContext()) return;
      setVerified({ receiptId, accountId: userId });
    }
    void measure(state.receiptId);
    return () => {
      current = false;
    };
  }, [allowed, isLoading, state, userId]);
  useEffect(() => {
    if (!allowed || isLoading || !grant) return;
    const page = grant + pathname;
    if (page !== lastPage.current && getCheckoutTrackingContext()) {
      lastPage.current = page;
      capture({ event: "public_page_viewed" });
    }
  }, [allowed, isLoading, grant, pathname]);
  async function choose(choice: "accepted" | "declined") {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(false);
    const current = invalidateRequests();
    if (choice === "declined") {
      setVerified(null);
      setState({ choice: "declined", pending: true });
    }
    try {
      const next = await setAnalyticsConsent(choice);
      if (current === sequence.current) setState(next);
    } catch {
      if (current === sequence.current) setError(true);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <ViewGrant.Provider value={grant}>
      {children}
      {allowed && !isLoading && state && (
        <ConsentBanner state={state} busy={busy} error={error} onChoice={choose} />
      )}
    </ViewGrant.Provider>
  );
}
