import { z } from "zod";
import { generateIdempotencyKey } from "@/lib/checkout/idempotency";

type StoragePair = readonly [string, string] | null;
type PairKeys = { first: string; second: string; journal: string };
const financial: PairKeys = {
  first: "checkout_idempotency_key",
  second: "checkout_cart_fingerprint",
  journal: "checkout_attempt_rollback_v1",
};
const credential: PairKeys = {
  first: "rdk_guest_order_id",
  second: "rdk_guest_order_token",
  journal: "checkout_guest_rollback_v1",
};
const DEVICE_SESSION_KEY = "rdk_checkout_device_session_id";
const RECOVERY = "checkout_original_recovery_v1";
function changedFinancialPair() {
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function")
    window.dispatchEvent(new Event("checkout-financial-pair"));
}
const MAX_FINGERPRINT_LENGTH = 32768;
function recoveryRecord(ownerId: string | null, storage: Storage) {
  const raw = storage.getItem(RECOVERY);
  if (!raw) return null;
  if (raw.length > MAX_FINGERPRINT_LENGTH * 2 + 1024)
    throw Error("Original checkout recovery data is incomplete.");
  const record = JSON.parse(raw);
  if (record.ownerId !== ownerId) return null;
  const pair = requirePair(record.pair);
  if (!pair || !equal(pair, readPair(storage, financial))) return null;
  if (
    !z.uuid().safeParse(pair[0]).success ||
    pair[1].length > MAX_FINGERPRINT_LENGTH ||
    (record.orderId !== undefined && !z.uuid().safeParse(record.orderId).success)
  )
    throw Error("Original checkout recovery data is incomplete.");
  return {
    pair,
    deviceId: record.deviceId,
    orderId: typeof record.orderId === "string" ? record.orderId : null,
  };
}
export function needsOriginalRecovery(
  ownerId: string | null,
  storage = getSessionStorage(),
) {
  try {
    return !!storage && recoveryRecord(ownerId, storage) !== null;
  } catch {
    return true;
  }
}
function markRecovery(
  storage: Storage,
  ownerId: string | null | undefined,
  pair: StoragePair,
  orderId?: string,
  deviceId?: string | null,
) {
  try {
    if (!pair || !equal(pair, readPair(storage, financial))) return;
    const existing = ownerId === undefined ? null : recoveryRecord(ownerId, storage);
    if (existing?.orderId && orderId && existing.orderId !== orderId) return;
    storage.setItem(
      RECOVERY,
      JSON.stringify({
        ownerId,
        pair,
        deviceId: existing?.deviceId ?? deviceId ?? undefined,
        orderId: existing?.orderId ?? orderId,
      }),
    );
  } catch {
    /* The original pair and any in-memory reference survive an optional marker write failure. */
  }
}
export function originalRecoveryContext(
  ownerId: string | null,
  storage = getSessionStorage(),
) {
  if (!storage) return null;
  const original = recoveryRecord(ownerId, storage);
  if (!original) return null;
  const device = original.deviceId ?? storage.getItem(DEVICE_SESSION_KEY);
  const observedGuest = observeStoredGuestAccess(storage);
  const current = () => {
    try {
      const active = recoveryRecord(ownerId, storage);
      return (
        !!active &&
        equal(active.pair, original.pair) &&
        device === storage.getItem(DEVICE_SESSION_KEY) &&
        (original.orderId === null || active.orderId === original.orderId)
      );
    } catch {
      return false;
    }
  };
  return {
    key: original.pair[0],
    fingerprint: original.pair[1],
    device,
    orderId: original.orderId ?? readPreparedScope(ownerId, storage)?.orderId ?? null,
    current,
    accept(orderId: string, token?: string) {
      const active = recoveryRecord(ownerId, storage);
      if (
        !current() ||
        (active?.orderId && active.orderId !== orderId) ||
        (ownerId === null && !observedGuest())
      )
        throw Error("Your checkout changed. Review your current order.");
      markRecovery(storage, ownerId, original.pair, orderId, device);
      if (!token) return { orderId };
      try {
        storeGuestOrderAccess(orderId, token, storage);
        return { orderId };
      } catch {
        return { orderId, transientGuestAccessToken: token };
      }
    },
  };
}
const SWITCH = "checkout_replacing_attempt_v1";
const HOUSEKEEPING = "checkout_prepared_housekeeping_v1";

function getSessionStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function requirePair(value: unknown): StoragePair {
  if (value === null) return null;
  if (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((part) => typeof part === "string" && part.length > 0)
  )
    return [value[0], value[1]];
  throw Error(
    "Checkout storage is incomplete. Reopen your original order to check its status.",
  );
}
function readPair(storage: Storage, keys: PairKeys): StoragePair {
  const journal = storage.getItem(keys.journal);
  if (journal !== null) return requirePair(JSON.parse(journal));
  const first = storage.getItem(keys.first),
    second = storage.getItem(keys.second);
  return requirePair(first === null && second === null ? null : [first, second]);
}
function equal(a: StoragePair, b: StoragePair) {
  return a?.[0] === b?.[0] && a?.[1] === b?.[1];
}
function writeFields(storage: Storage, keys: PairKeys, value: StoragePair) {
  if (value) {
    storage.setItem(keys.first, value[0]);
    storage.setItem(keys.second, value[1]);
  } else {
    storage.removeItem(keys.first);
    storage.removeItem(keys.second);
  }
}
// During an interrupted legacy two-field write the journal is the committed pair.
// Removing the journal publishes the replacement, including a successful clear.
function publish(storage: Storage, keys: PairKeys, value: StoragePair) {
  const previous = readPair(storage, keys);
  if (storage.getItem(keys.journal) === null) {
    if (equal(previous, value)) return;
    storage.setItem(keys.journal, JSON.stringify(previous));
  }
  try {
    writeFields(storage, keys, value);
    storage.removeItem(keys.journal);
  } catch (error) {
    try {
      writeFields(storage, keys, previous);
      storage.removeItem(keys.journal);
    } catch {
      /* The journal remains authoritative until storage accepts another write. */
    }
    throw error;
  }
}
// Every committed read and publication shares this identity. Observing a different
// pair retires all previous readers, even if a later write restores the original bytes.
type GuestObservation = { pair: StoragePair | undefined };
const guestObservations = new WeakMap<Storage, GuestObservation>();
function readGuestObservation(storage: Storage): GuestObservation {
  let pair: StoragePair | undefined;
  try {
    pair = readPair(storage, credential);
  } catch {
    /* An unreadable credential retires the prior observation. */
  }
  const previous = guestObservations.get(storage);
  if (
    previous &&
    (previous.pair === pair ||
      (previous.pair !== undefined && pair !== undefined && equal(previous.pair, pair)))
  )
    return previous;
  const current = { pair };
  guestObservations.set(storage, current);
  return current;
}
function noteGuestPublication(storage: Storage | null) {
  if (storage) readGuestObservation(storage);
}
let listening: Window | undefined;
function listenForGuestPublication() {
  if (
    typeof window === "undefined" ||
    typeof window.addEventListener !== "function" ||
    window === listening
  )
    return;
  listening = window;
  window.addEventListener("checkout-guest-access", () =>
    noteGuestPublication(getSessionStorage()),
  );
  window.addEventListener("storage", (event) => {
    if (
      event.key !== null &&
      event.key !== credential.first &&
      event.key !== credential.second &&
      event.key !== credential.journal
    )
      return;
    const storage = getSessionStorage();
    if (event.storageArea === null || event.storageArea === storage)
      noteGuestPublication(storage);
  });
}
export function observeStoredGuestAccess(storage = getSessionStorage()) {
  if (!storage) return () => false;
  listenForGuestPublication();
  const original = readGuestObservation(storage);
  return () => readGuestObservation(storage) === original && original.pair !== undefined;
}

export function resolveCheckoutAttempt(
  fingerprint: string,
  storage = getSessionStorage(),
  createId = generateIdempotencyKey,
) {
  if (!storage)
    throw Error("Checkout storage is unavailable. Reopen checkout to continue.");
  const issuedDevice = storage.getItem(DEVICE_SESSION_KEY);
  const previous = readPair(storage, financial);
  if (previous && !z.uuid().safeParse(previous[0]).success)
    throw Error(
      "The saved checkout attempt is incomplete. Check the original order before paying again.",
    );
  if (previous?.[1] !== fingerprint && storage.getItem(financial.journal) !== null)
    publish(storage, financial, previous);
  const guestCurrent = observeStoredGuestAccess(storage);
  const reused = previous?.[1] === fingerprint ? previous[0] : null;
  const mode: "new" | "resume" = reused ? "resume" : "new";
  const key = reused ?? createId();
  const original: StoragePair = [key, fingerprint];
  const current = () => equal(readPair(storage, financial), original);
  const interrupted = () => {
    const raw = storage.getItem(SWITCH);
    if (!raw || !previous) return false;
    try {
      const record = JSON.parse(raw);
      return (
        equal(requirePair(record.source), previous) &&
        typeof record.targetFingerprint === "string" &&
        record.targetFingerprint.length > 0 &&
        record.targetFingerprint !== previous[1]
      );
    } catch {
      return false;
    }
  };
  let started: string | undefined;
  const forget = (raw: string | undefined) => {
    try {
      if (raw && storage.getItem(SWITCH) === raw) storage.removeItem(SWITCH);
    } catch {
      /* A changed financial pair cannot reuse this record. */
    }
  };
  return {
    mode,
    key,
    current,
    protectIssuedAttempt() {
      if (mode !== "new" || !previous) return;
      if (!equal(previous, readPair(storage, financial)))
        throw Error("Your checkout changed. Review your current order.");
      if (interrupted()) return;
      started = JSON.stringify({ source: previous, targetFingerprint: fingerprint });
      storage.setItem(SWITCH, started);
    },
    requireRecovery(ownerId?: string | null, orderId?: string) {
      if (current()) markRecovery(storage, ownerId, original, orderId, issuedDevice);
    },
    rejectCapture() {
      forget(started);
    },
    interruptedSwitch: () => mode === "resume" && current() && interrupted(),

    commit() {
      if (!equal(previous, readPair(storage, financial))) return false;
      const protectedSwitch = mode === "new" ? storage.getItem(SWITCH) : null;
      publish(storage, financial, original);
      if (!equal(previous, original)) changedFinancialPair();
      forget(protectedSwitch ?? undefined);
      return true;
    },
    reject() {
      if (!current()) return false;
      const record = storage.getItem(SWITCH);
      publish(storage, financial, null);
      changedFinancialPair();
      forget(record ?? undefined);
      return true;
    },
    prepared(
      orderId: string,
      token: string | undefined,
      eligible: boolean,
      ownerId?: string | null,
    ) {
      if (!current()) return false;
      if (token && guestCurrent()) {
        try {
          storeGuestOrderAccess(orderId, token, storage);
        } catch {
          /* The returned grant remains available to this mounted checkout. */
        }
      }
      if (eligible) {
        try {
          storage.setItem(
            HOUSEKEEPING,
            JSON.stringify({
              orderId,
              key,
              fingerprint,
              ownerId,
              guestToken: ownerId === null ? token : undefined,
            }),
          );
        } catch {
          /* Purchase consumption remains eligible. */
        }
      }
      return true;
    },
  };
}
export function finishCheckoutAttempt(
  orderId: string,
  matchedKey: string,
  storage = getSessionStorage(),
  onCleared?: () => void,
) {
  try {
    if (!storage) return;
    const record = JSON.parse(storage.getItem(HOUSEKEEPING) ?? "null");
    if (
      record?.orderId !== orderId ||
      record.key !== matchedKey ||
      typeof record.fingerprint !== "string" ||
      !record.fingerprint
    )
      return;
    if (equal(readPair(storage, financial), [matchedKey, record.fingerprint])) {
      publish(storage, financial, null);
      onCleared?.();
      try {
        storage.removeItem(SWITCH);
        storage.removeItem(HOUSEKEEPING);
        const recovery = JSON.parse(storage.getItem(RECOVERY) ?? "null");
        if (
          recovery &&
          equal(requirePair(recovery.pair), [matchedKey, record.fingerprint])
        )
          storage.removeItem(RECOVERY);
      } finally {
        changedFinancialPair();
      }
      return;
    }
    storage.removeItem(HOUSEKEEPING);
  } catch {
    /* Another matched receipt can resume an interrupted write. */
  }
}

export function getOrCreateCheckoutDeviceSessionId(
  storage: Storage | null = getSessionStorage(),
  createId: () => string = generateIdempotencyKey,
): string {
  const existing = storage?.getItem(DEVICE_SESSION_KEY);
  if (existing) {
    return existing;
  }

  const id = createId();
  storage?.setItem(DEVICE_SESSION_KEY, id);
  return id;
}

export function storeGuestOrderAccess(
  orderId: string,
  token: string,
  storage: Storage | null = getSessionStorage(),
): void {
  if (!storage) return;
  noteGuestPublication(storage);
  publish(storage, credential, [orderId, token]);
  noteGuestPublication(storage);
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event("checkout-guest-access"));
}

export function readGuestOrderAccess(
  orderId: string,
  storage: Storage | null = getSessionStorage(),
): string | null {
  const pair = storage ? readGuestObservation(storage).pair : null;
  return pair?.[0] === orderId ? pair[1] : null;
}

export function readPreparedScope(ownerId: string | null, storage = getSessionStorage()) {
  try {
    if (!storage) return null;
    const record = JSON.parse(storage.getItem(HOUSEKEEPING) ?? "null");
    if (
      !record ||
      !z.uuid().safeParse(record.key).success ||
      typeof record.fingerprint !== "string" ||
      !record.fingerprint ||
      record.scopeClosed ||
      record.ownerId !== ownerId ||
      !z.uuid().safeParse(record.orderId).success ||
      !equal(readPair(storage, financial), [record.key, record.fingerprint])
    )
      return null;
    if (
      ownerId === null &&
      (!record.guestToken ||
        readGuestOrderAccess(record.orderId, storage) !== record.guestToken)
    )
      return null;
    return {
      orderId: record.orderId as string,
      guestAccessToken: ownerId === null ? (record.guestToken as string) : undefined,
    };
  } catch {
    return null;
  }
}

export function closePreparedScope(
  orderId: string,
  token: string | null,
  ownerId: string | null,
  storage = getSessionStorage(),
) {
  try {
    const active = readPreparedScope(ownerId, storage);
    if (
      !storage ||
      active?.orderId !== orderId ||
      (active.guestAccessToken ?? null) !== token
    )
      return;
    const record = JSON.parse(storage.getItem(HOUSEKEEPING)!);
    storage.setItem(HOUSEKEEPING, JSON.stringify({ ...record, scopeClosed: true }));
  } catch {
    /* A later verified observation may close it. */
  }
}
export function readFinancialPair(storage = getSessionStorage()) {
  try {
    return storage ? JSON.stringify(readPair(storage, financial)) : null;
  } catch {
    return null;
  }
}
