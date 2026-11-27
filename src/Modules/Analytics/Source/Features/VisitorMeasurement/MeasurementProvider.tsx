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
import { SESSION_REVALIDATING } from "@/lib/auth/session-events";
import { isAdminRole } from "@/config/constants/roles";
import { configuredMeasurement, isApprovedMeasurementHostname } from "./host-gate";
import { getAnalyticsConsent, setAnalyticsConsent } from "./consent";
import {
  capture,
  getCheckoutTrackingContext,
  initializeMeasurement,
  verifyMeasurementIdentity,
  revokeMeasurement,
  setMeasurementAccount,
  suspendMeasurementAccount,
} from "./client";
import { safePathname, type ConsentState } from "./contract";
import { withdrawalKey } from "./preference-marker";
import { ConsentBanner } from "./ConsentBanner";
import { CheckoutMeasurement, ViewGrant } from "./view-grant";

const config = configuredMeasurement();
export function MeasurementProvider({ children }: { children: ReactNode }) {
  const {
    user,
    role,
    isLoading,
    sessionRevision = 0,
    sessionAvailable = true,
    refreshSession,
  } = useSession();
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
    revision: number;
  } | null>(null);
  const grant =
    allowed &&
    !isLoading &&
    state?.choice === "accepted" &&
    verified?.receiptId === state.receiptId &&
    sessionAvailable &&
    verified.revision === sessionRevision &&
    verified.accountId === userId
      ? verified.receiptId
      : null;
  const checkoutPhase =
    !allowed || (state && state.choice !== "accepted")
      ? "off"
      : grant
        ? "ready"
        : "hydrating";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const sequence = useRef(0);
  const invalidateRequests = useCallback(() => ++sequence.current, []);
  const saving = useRef(false);
  const lastPage = useRef("");
  useLayoutEffect(() => {
    if (isLoading || !sessionAvailable) suspendMeasurementAccount();
    else setMeasurementAccount(userId, !allowed);
    window.addEventListener(SESSION_REVALIDATING, suspendMeasurementAccount);
    return () =>
      window.removeEventListener(SESSION_REVALIDATING, suspendMeasurementAccount);
  }, [allowed, isLoading, sessionAvailable, userId]);
  const accepted = state?.choice === "accepted";
  useEffect(() => {
    if (!accepted || !allowed || !refreshSession) return;
    let refreshing = false;
    const resume = () => {
      if (refreshing) return;
      refreshing = true;
      void refreshSession().finally(() => {
        refreshing = false;
      });
    };
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) resume();
    };
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    window.addEventListener("pageshow", restored);
    return () => {
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("pageshow", restored);
    };
  }, [accepted, allowed, refreshSession]);
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
          suspendMeasurementAccount();
        }
      },
    );
  }, [allowed, invalidateRequests]);
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
    if (!allowed || !state || !config) {
      lastPage.current = "";
      return;
    }
    if (state.choice !== "accepted") {
      revokeMeasurement();
      lastPage.current = "";
      return;
    }
    if (isLoading || !sessionAvailable) return;
    setMeasurementAccount(userId, false);
    initializeMeasurement(config, state);
    let timer: number | undefined;
    async function measure(receiptId: string, canRetry: boolean) {
      const result = await verifyMeasurementIdentity();
      if (!current) return;
      if (result === "unavailable" && canRetry) {
        timer = window.setTimeout(() => {
          void measure(receiptId, false);
        }, 5000);
        return;
      }
      if (result === "ready" && getCheckoutTrackingContext())
        setVerified({ receiptId, accountId: userId, revision: sessionRevision });
    }
    void measure(state.receiptId, true);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [allowed, isLoading, sessionAvailable, sessionRevision, state, userId]);
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
      <CheckoutMeasurement.Provider value={checkoutPhase}>
        {children}
      </CheckoutMeasurement.Provider>
      {allowed && !isLoading && state && (
        <ConsentBanner state={state} busy={busy} error={error} onChoice={choose} />
      )}
    </ViewGrant.Provider>
  );
}
