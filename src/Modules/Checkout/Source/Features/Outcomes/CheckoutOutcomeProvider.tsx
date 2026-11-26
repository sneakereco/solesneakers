"use client";
import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useCart } from "@/Modules/Cart/Source/Client";
import {
  readPreparedScope,
  closePreparedScope,
  readFinancialPair,
} from "./client-session";
import type { OrderStatusResponse } from "@/types/domain/checkout";

function registrations() {
  let active: { id: string; token: string | null; unregister: () => void } | null = null;
  return {
    register(id: string, token: string | null, unregister: () => void) {
      active?.unregister();
      active = { id, token, unregister };
    },
    release(id: string, token: string | null) {
      if (active && active.id === id && active.token === token) {
        active.unregister();
        active = null;
      }
    },
  };
}
interface VerifiedHandoff {
  token: string | null;
  order: OrderStatusResponse;
  lifetime: AbortController;
  financialPair?: string | null;
}
function makeHandoff() {
  let next: VerifiedHandoff | null = null;
  return {
    put(value: VerifiedHandoff) {
      next?.lifetime.abort();
      next = { ...value, financialPair: readFinancialPair() };
    },
    take(orderId: string, token: string | null) {
      const value = next;
      next = null;
      if (
        value?.order.id === orderId &&
        value.token === token &&
        value.financialPair === readFinancialPair()
      )
        return value;
      value?.lifetime.abort();
      return null;
    },
    clear() {
      next?.lifetime.abort();
      next = null;
    },
  };
}
function preparedCredential() {
  let value: { orderId: string; token: string } | null = null;
  return {
    remember(orderId: string, token?: string) {
      value = token ? { orderId, token } : null;
    },
    read(orderId: string | null) {
      return value?.orderId === orderId ? value?.token : null;
    },
    retain(orderId: string | null) {
      if (value?.orderId !== orderId) value = null;
    },
  };
}
const Access = createContext<{
  handoff: ReturnType<typeof makeHandoff>;
  credential: ReturnType<typeof preparedCredential>;
  current: () => boolean;
  scopes: ReturnType<typeof registrations>;
  closeScope: (id: string, token: string | null) => void;
  account: boolean;
} | null>(null);
export function useCheckoutRegistration() {
  return useContext(Access)?.scopes;
}
export function useProcessingCredential() {
  return useContext(Access)?.credential.remember;
}
export function CheckoutOutcomeProvider({
  children,
  observation,
  ownerId,
  account,
  path,
}: {
  children: ReactNode;
  observation: () => boolean;
  ownerId: string | null;
  account: boolean;
  path: string;
}) {
  const scopes = useMemo(() => registrations(), []);
  const { isReady, scopeValidationToOrder } = useCart();
  const restoredOwner = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    if (!isReady || !observation()) return;
    const key = ownerId === null ? "guest" : "account:" + ownerId;
    if (restoredOwner.current === key) return;
    restoredOwner.current = key;
    const prepared = readPreparedScope(ownerId);
    if (!prepared) return;
    const query = new URLSearchParams(location.search);
    if (
      path !== "/checkout" &&
      (query.get("orderId") !== prepared.orderId ||
        (query.has("token") && query.get("token") !== prepared.guestAccessToken))
    )
      return;
    const release = scopeValidationToOrder(prepared);
    scopes.register(prepared.orderId, prepared.guestAccessToken ?? null, release);
  }, [isReady, ownerId, observation, path, scopeValidationToOrder, scopes]);
  const access = useMemo(
    () => ({
      handoff: makeHandoff(),
      credential: preparedCredential(),
      account,
      current: observation,
      scopes,
      closeScope: (id: string, token: string | null) => {
        scopes.release(id, token);
        closePreparedScope(id, token, ownerId);
      },
    }),
    [observation, account, ownerId, scopes],
  );
  useLayoutEffect(() => {
    if (path !== "/checkout/success" && path !== "/checkout/processing") {
      access.handoff.clear();
      access.credential.retain(null);
    }
  }, [path, access]);
  useLayoutEffect(
    () => () => {
      access.handoff.clear();
      access.credential.retain(null);
    },
    [access],
  );
  return <Access.Provider value={access}>{children}</Access.Provider>;
}
export function useOutcomeAccess() {
  const access = useContext(Access);
  if (!access) throw Error("Checkout outcomes require the checkout layout.");
  return access;
}
