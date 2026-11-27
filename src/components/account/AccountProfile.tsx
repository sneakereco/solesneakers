// src/components/account/AccountProfile.tsx
"use client";

import { notifySessionUpdate } from "@/lib/auth/session-events";
import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";

import type { Tables } from "@/types/db/database.types";
import { PasswordRequirements } from "@/components/auth/register/PasswordRequirements";
import { isPasswordValid } from "@/lib/validation/password";
import { ActionButton } from "@/components/ui/ActionButton";
import { RequestError } from "@/components/ui/RequestError";
import { useAsyncAction } from "@/components/ui/useAsyncAction";
import { useSession } from "@/contexts/SessionContext";
import { fetchAccountJson } from "@/lib/account/request";
import { ResponseError } from "@/lib/http/read-json-response";
import { withRequestDeadline } from "@/lib/http/request-deadline";

import {
  AccountSkeleton,
  AddressesSkeleton,
  OrdersSkeleton,
  ShippingProfileSkeleton,
} from "./AccountSkeletons";
import { AccountLoadError } from "./AccountLoadError";
import { useAccountResource } from "./use-account-resource";

type ShippingProfile = Tables<"shipping_profiles">;

type AccountOrderItem = {
  id: string;
  product_name?: string | null;
  size_label?: string | null;
  quantity?: number | null;
  product?: {
    brand?: string | null;
    name?: string | null;
  } | null;
  variant?: Record<string, never> | null;
};

type AccountOrder = {
  id: string;
  created_at: string;
  status?: string | null;
  total?: number | null;
  fulfillment?: string | null;
  shipping_carrier?: string | null;
  tracking_number?: string | null;
  items?: AccountOrderItem[] | null;
};

type AccountAddress = {
  id: string;
  name?: string | null;
  phone?: string | null;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  postal_code: string;
  country: string;
};

type AddressInput = Omit<AccountAddress, "id">;
type Result = { tone: "success" | "error"; message: string };
type DefaultResult = { ok: true } | { ok: false; message: string; addressChanged?: true };
type DefaultRetry = { address: AccountAddress | null; message: string };

const emptyAddress = {
  name: "",
  phone: "",
  line1: "",
  line2: "",
  city: "",
  state: "",
  postal_code: "",
  country: "",
};

const addressFields = [
  "line1",
  "line2",
  "city",
  "state",
  "postal_code",
  "country",
] as const;

function sameAddress(left: Partial<AddressInput>, right: Partial<AddressInput>) {
  const normalize = (value?: string | null) => (value ?? "").trim().toLowerCase();
  return addressFields.every(
    (field) => normalize(left[field]) === normalize(right[field]),
  );
}

const savedAddressFields = [...addressFields, "name", "phone"] as const;

function sameSavedAddress(left: AddressInput, right: AddressInput) {
  return savedAddressFields.every(
    (field) => (left[field] ?? "").trim() === (right[field] ?? "").trim(),
  );
}

function asAddress(profile: Partial<ShippingProfile>): Partial<AddressInput> {
  return {
    line1: profile.address_line1 ?? undefined,
    line2: profile.address_line2,
    city: profile.city ?? undefined,
    state: profile.state ?? undefined,
    postal_code: profile.postal_code ?? undefined,
    country: profile.country ?? undefined,
  };
}

function parseProfile(value: unknown): Partial<ShippingProfile> {
  if (!value || typeof value !== "object" || Array.isArray(value) || "error" in value) {
    throw new Error("Invalid shipping profile");
  }
  return value;
}

function parseAddresses(value: unknown): AccountAddress[] {
  if (
    !value ||
    typeof value !== "object" ||
    !("addresses" in value) ||
    !Array.isArray(value.addresses)
  ) {
    throw new Error("Invalid saved addresses");
  }
  return value.addresses;
}

function parseAddressSave(value: unknown): {
  address: AccountAddress;
  addresses?: AccountAddress[];
} {
  if (!value || typeof value !== "object" || !("address" in value)) {
    throw new Error("Address save could not be confirmed");
  }
  const saved = value.address;
  if (
    !saved ||
    typeof saved !== "object" ||
    !("id" in saved) ||
    typeof saved.id !== "string" ||
    !saved.id
  ) {
    throw new Error("Address save returned an invalid record");
  }
  const record = saved as Record<string, unknown>;
  const requiredFields = ["line1", "city", "state", "postal_code", "country"];
  const optionalFields = ["line2", "name", "phone"];
  if (
    requiredFields.some((field) => typeof record[field] !== "string" || !record[field]) ||
    optionalFields.some((field) => {
      const detail = record[field];
      return detail !== null && detail !== undefined && typeof detail !== "string";
    })
  ) {
    throw new Error("Address save returned incomplete details");
  }
  return {
    address: saved as AccountAddress,
    addresses:
      "addresses" in value && Array.isArray(value.addresses)
        ? value.addresses
        : undefined,
  };
}

function parseOrders(value: unknown): AccountOrder[] {
  if (
    !value ||
    typeof value !== "object" ||
    !("orders" in value) ||
    !Array.isArray(value.orders)
  ) {
    throw new Error("Invalid order history");
  }
  return value.orders;
}

const signInHref = "/auth/login?next=%2Faccount";

function ResourceError({
  label,
  resource,
}: {
  label: string;
  resource: {
    error: "sign-in" | "owner-changed" | "unavailable" | null;
    loading: boolean;
    load: () => Promise<unknown>;
  };
}) {
  if (!resource.error) return null;
  return (
    <div className="mt-4">
      {resource.error === "sign-in" ? (
        <RequestError
          message={`Sign in again to view ${label}.`}
          signInHref={signInHref}
        />
      ) : (
        <RequestError
          message={`Could not load ${label}.`}
          onRetry={() => void resource.load()}
          retrying={resource.loading}
        />
      )}
    </div>
  );
}

function ActionResult({ result, id }: { result: Result | null; id: string }) {
  if (!result) return null;
  return (
    <p
      id={id}
      role={result.tone === "error" ? "alert" : "status"}
      className={`border px-5 py-4 text-sm ${
        result.tone === "success"
          ? "border-emerald-200 bg-[#f7fbf8] text-emerald-700"
          : "border-red-200 bg-[#fff8f8] text-red-700"
      }`}
    >
      {result.message}
    </p>
  );
}

function failedAction(error: unknown, fallback: string) {
  return error instanceof ResponseError && error.status === 401
    ? `${fallback} Sign in again and retry.`
    : fallback;
}

const fieldClassName =
  "h-12 w-full border border-zinc-300 bg-white px-4 text-[0.95rem] text-zinc-900 transition-colors placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none disabled:cursor-not-allowed disabled:bg-zinc-100";
const fieldLabelClassName =
  "mb-2 block text-[0.7rem] font-medium uppercase tracking-[0.16em] text-zinc-500";
const primaryButtonClassName =
  "inline-flex min-h-12 items-center justify-center bg-[#1f1f1d] px-6 text-xs font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-50";
const textButtonClassName =
  "text-xs font-medium uppercase tracking-[0.1em] text-zinc-500 transition-colors hover:text-black disabled:cursor-not-allowed disabled:opacity-50";

type AccountProps = { userId: string; userEmail: string };

export function AccountProfile({ userId, userEmail }: AccountProps) {
  const session = useSession();
  if (session.user?.id !== userId) {
    return session.isLoading ? (
      <AccountSkeleton />
    ) : (
      <AccountLoadError ownerChanged={!session.isSessionUnavailable} />
    );
  }

  return (
    <AccountDetails
      key={userId}
      userId={userId}
      userEmail={userEmail}
      canChangeAccount={!session.isLoading && !session.isSessionUnavailable}
    />
  );
}

function AccountDetails({
  userId,
  userEmail,
  canChangeAccount,
}: AccountProps & { canChangeAccount: boolean }) {
  const router = useRouter();
  const profileResource = useAccountResource(
    userId,
    "/api/account/shipping",
    parseProfile,
  );
  const addressResource = useAccountResource(
    userId,
    "/api/account/addresses",
    parseAddresses,
  );
  const orderResource = useAccountResource(userId, "/api/account/orders", parseOrders);
  const profile = profileResource.data;
  const addresses = addressResource.data;
  const orders = orderResource.data;

  const addressAction = useAsyncAction();
  const passwordAction = useAsyncAction();
  const logoutAction = useAsyncAction();
  const [addressOperation, setAddressOperation] = useState("");
  const [addressResult, setAddressResult] = useState<Result | null>(null);
  const [defaultRetry, setDefaultRetry] = useState<DefaultRetry | null>(null);
  const [unconfirmedSave, setUnconfirmedSave] = useState<{
    draft: AddressInput;
    makeDefault: boolean;
  } | null>(null);
  const [addressRefreshNeeded, setAddressRefreshNeeded] = useState<
    "partial-save" | "stale-default" | null
  >(null);
  const [passwordResult, setPasswordResult] = useState<Result | null>(null);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [newPasswordVisible, setNewPasswordVisible] = useState(false);
  const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false);
  const [setAsDefault, setSetAsDefault] = useState(false);
  const [addressForm, setAddressForm] = useState(emptyAddress);
  const [ownerConflict, setOwnerConflict] = useState(false);
  const activeOwner = useRef<AbortController | null>(null);
  const ownerReady = useRef(canChangeAccount);
  const ownerChanged =
    ownerConflict ||
    profileResource.error === "owner-changed" ||
    addressResource.error === "owner-changed" ||
    orderResource.error === "owner-changed";
  const accountActionsAvailable = canChangeAccount && !ownerChanged;
  const addressActionsAvailable = accountActionsAvailable && !unconfirmedSave;
  const savedDefaultAvailable =
    addressActionsAvailable && addressRefreshNeeded !== "stale-default";
  const addressFormLocked =
    Boolean(unconfirmedSave) || (addressAction.pending && addressOperation === "add");
  const retrySnapshot = defaultRetry?.address;
  const retryAddress = retrySnapshot
    ? addresses?.find(
        (saved) =>
          saved.id === retrySnapshot.id && sameSavedAddress(saved, retrySnapshot),
      )
    : null;
  const showDefaultRetry = defaultRetry && (!defaultRetry.address || retryAddress);

  useLayoutEffect(() => {
    if (ownerChanged) return;
    const controller = new AbortController();
    activeOwner.current = controller;
    return () => {
      activeOwner.current = null;
      controller.abort();
    };
  }, [ownerChanged]);

  useLayoutEffect(() => {
    ownerReady.current = accountActionsAvailable;
  }, [accountActionsAvailable]);

  function postAccountJson(url: string, body: unknown, ownerSignal: AbortSignal) {
    return fetchAccountJson<unknown>(userId, url, "Account update failed", ownerSignal, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function commandFailure(error: unknown, fallback: string) {
    if (error instanceof ResponseError && error.status === 409) {
      activeOwner.current?.abort();
      setOwnerConflict(true);
    }
    return failedAction(error, fallback);
  }

  function isDefaultAddress(address: AccountAddress) {
    return Boolean(profile?.address_line1 && sameAddress(asAddress(profile), address));
  }

  async function updateDefault(
    address: AddressInput | null,
    ownerSignal: AbortSignal,
    savedAddressId?: string,
  ): Promise<DefaultResult> {
    if (!ownerReady.current || ownerSignal.aborted) {
      return {
        ok: false,
        message: "Verify your account before updating the default shipping address.",
      };
    }
    try {
      const data = await postAccountJson(
        "/api/account/shipping",
        {
          ...(savedAddressId ? { savedAddressId } : {}),
          full_name: address?.name ?? null,
          phone: address?.phone ?? null,
          address_line1: address?.line1 ?? null,
          address_line2: address?.line2 ?? null,
          city: address?.city ?? null,
          state: address?.state ?? null,
          postal_code: address?.postal_code ?? null,
          country: address?.country ?? null,
        },
        ownerSignal,
      );
      const savedProfile = parseProfile(data);
      if (
        address
          ? !savedProfile.address_line1 || !sameAddress(asAddress(savedProfile), address)
          : savedProfile.address_line1 !== null
      ) {
        throw new Error("Default shipping update could not be confirmed");
      }
      profileResource.replace(savedProfile);
      return { ok: true };
    } catch (error) {
      if (savedAddressId && error instanceof ResponseError && error.status === 412) {
        return {
          ok: false,
          addressChanged: true,
          message:
            "Saved address changed. Refresh your saved addresses and select the current address.",
        };
      }
      const message = address
        ? "Could not set the default shipping address."
        : "Could not clear the default shipping address.";
      return { ok: false, message: commandFailure(error, message) };
    }
  }

  function runAddressAction(
    operation: string,
    work: (ownerSignal: AbortSignal) => Promise<void>,
  ) {
    const signal = activeOwner.current?.signal;
    if (
      !ownerReady.current ||
      !signal ||
      signal.aborted ||
      (unconfirmedSave && operation !== "check-address")
    )
      return;
    void addressAction.run(async () => {
      setAddressOperation(operation);
      setAddressResult(null);
      await work(signal);
    });
  }

  function reconcileDefaultRetry(saved: AccountAddress[]) {
    setDefaultRetry((retry) => {
      const previous = retry?.address;
      if (!previous) return retry;
      return saved.some(
        (address) => address.id === previous.id && sameSavedAddress(address, previous),
      )
        ? retry
        : null;
    });
  }

  function handleAddressCheck() {
    runAddressAction("check-address", async (signal) => {
      const saved = await addressResource.load();
      if (signal.aborted) return;
      if (!saved) {
        setAddressResult({
          tone: "error",
          message: unconfirmedSave
            ? "Could not check saved addresses. Your draft is still here."
            : addressRefreshNeeded === "partial-save"
              ? "Address saved. Could not refresh your saved addresses."
              : "Could not refresh your saved addresses. Try again.",
        });
        return;
      }

      setAddressRefreshNeeded(null);
      reconcileDefaultRetry(saved);
      if (!unconfirmedSave) {
        if (addressRefreshNeeded === "stale-default") {
          setAddressResult({ tone: "success", message: "Saved addresses refreshed." });
        }
        return;
      }
      setUnconfirmedSave(null);
      const match = saved.find((address) =>
        sameSavedAddress(address, unconfirmedSave.draft),
      );
      if (match) {
        setAddressForm(emptyAddress);
        setSetAsDefault(false);
      }
      setAddressResult({
        tone: match ? "success" : "error",
        message: match
          ? unconfirmedSave.makeDefault
            ? "This address is in your saved addresses. Use Set as default to select it for checkout."
            : "This address is in your saved addresses."
          : "Saved addresses checked. Review your draft and try saving again.",
      });
    });
  }

  function handleDefault(address: AccountAddress | null, operation: string) {
    if (address && !savedDefaultAvailable) return;
    runAddressAction(operation, async (signal) => {
      const savedAddressId = operation === "retry-default" ? address?.id : undefined;
      const result = await updateDefault(address, signal, savedAddressId);
      if (signal.aborted) return;
      if (!result.ok) {
        if (result.addressChanged) {
          setDefaultRetry(null);
          setAddressRefreshNeeded("stale-default");
          setAddressResult({ tone: "error", message: result.message });
          return;
        }
        if (operation === "retry-default" && defaultRetry) {
          setDefaultRetry({
            ...defaultRetry,
            message: address
              ? `Address saved. The default update still failed. ${result.message}`
              : `Address removed. The default update still failed. ${result.message}`,
          });
          return;
        }
        setAddressResult({ tone: "error", message: result.message });
        return;
      }
      setDefaultRetry(null);
      setAddressResult({
        tone: "success",
        message: address
          ? "Default shipping address updated."
          : "Default shipping address cleared.",
      });
    });
  }

  function handleChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const signal = activeOwner.current?.signal;
    if (!ownerReady.current || !signal || signal.aborted) return;
    void passwordAction.run(async () => {
      setPasswordResult(null);

      if (newPassword !== confirmPassword || !isPasswordValid(newPassword)) {
        setPasswordResult({
          tone: "error",
          message:
            newPassword !== confirmPassword
              ? "Passwords do not match."
              : "Password does not meet the required criteria.",
        });
        return;
      }

      try {
        const response = await postAccountJson(
          "/api/account/password",
          {
            password: newPassword,
          },
          signal,
        );
        if (
          !response ||
          typeof response !== "object" ||
          !("ok" in response) ||
          response.ok !== true
        ) {
          throw new Error("Password change could not be confirmed");
        }
        setPasswordResult({ tone: "success", message: "Password changed successfully." });
        setNewPassword("");
        setConfirmPassword("");
        setNewPasswordVisible(false);
        setConfirmPasswordVisible(false);
      } catch (error) {
        if (signal.aborted) return;
        setPasswordResult({
          tone: "error",
          message: commandFailure(
            error,
            "Could not change your password. Please try again.",
          ),
        });
      }
    });
  }

  function handleSaveAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    runAddressAction("add", async (signal) => {
      let saved: ReturnType<typeof parseAddressSave>;
      try {
        const data = await postAccountJson("/api/account/addresses", addressForm, signal);
        saved = parseAddressSave(data);
      } catch (error) {
        if (signal.aborted) return;
        if (error instanceof ResponseError && [400, 401, 409].includes(error.status)) {
          setAddressResult({
            tone: "error",
            message: commandFailure(
              error,
              "Could not save address. Check the details and try again.",
            ),
          });
        } else {
          setUnconfirmedSave({ draft: addressForm, makeDefault: setAsDefault });
          setAddressResult({
            tone: "error",
            message:
              "Could not confirm whether the address was saved. Check saved addresses before trying again.",
          });
        }
        return;
      }

      const latestAddresses = saved.addresses ?? [
        saved.address,
        ...(addresses ?? []).filter((address) => address.id !== saved.address.id),
      ];
      addressResource.replace(latestAddresses);
      setAddressRefreshNeeded((previous) =>
        saved.addresses ? null : (previous ?? "partial-save"),
      );
      reconcileDefaultRetry(latestAddresses);
      setAddressForm(emptyAddress);
      setSetAsDefault(false);
      if (setAsDefault) {
        const current = latestAddresses.find(
          (address) => address.id === saved.address.id,
        );
        if (!current || !sameSavedAddress(current, saved.address)) {
          setAddressResult({
            tone: "error",
            message:
              "Address saved. The saved record changed. Review it before setting the default.",
          });
          return;
        }
        const result = await updateDefault(current, signal);
        if (signal.aborted) return;
        if (!result.ok) {
          setDefaultRetry({
            address: current,
            message: `Address saved. ${result.message}`,
          });
          return;
        }
        setDefaultRetry(null);
      }

      setAddressResult({
        tone: "success",
        message: setAsDefault
          ? "Address saved and set as the default shipping address."
          : saved.addresses
            ? "Address saved."
            : "Address saved. Refresh to load your complete address list.",
      });
    });
  }

  function handleDeleteAddress(address: AccountAddress) {
    if (!profile) return;
    runAddressAction(`remove:${address.id}`, async (signal) => {
      try {
        const response = await fetchAccountJson<{ ok?: boolean }>(
          userId,
          `/api/account/addresses/${address.id}`,
          "Address could not be removed",
          signal,
          { method: "DELETE" },
        );
        if (response?.ok !== true)
          throw new Error("Address removal could not be confirmed");
      } catch (error) {
        if (signal.aborted) return;
        setAddressResult({
          tone: "error",
          message: commandFailure(error, "Could not remove address. Please try again."),
        });
        return;
      }

      addressResource.replace((addresses ?? []).filter(({ id }) => id !== address.id));
      if (defaultRetry?.address?.id === address.id) {
        setDefaultRetry(null);
      }
      if (isDefaultAddress(address)) {
        const result = await updateDefault(null, signal);
        if (signal.aborted) return;
        if (!result.ok) {
          setDefaultRetry({
            address: null,
            message: `Address removed. ${result.message}`,
          });
          return;
        }
        setDefaultRetry(null);
      }

      setAddressResult({ tone: "success", message: "Address removed." });
    });
  }

  const getTrackingUrl = (carrier?: string | null, trackingNumber?: string | null) => {
    if (!trackingNumber) {
      return null;
    }
    const normalized = (carrier ?? "").toLowerCase();
    const encodedTracking = encodeURIComponent(trackingNumber);

    if (normalized.includes("ups")) {
      return `https://www.ups.com/track?loc=en_US&tracknum=${encodedTracking}`;
    }
    if (normalized.includes("usps")) {
      return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodedTracking}`;
    }
    if (normalized.includes("fedex") || normalized.includes("fed ex")) {
      return `https://www.fedex.com/fedextrack/?trknbr=${encodedTracking}`;
    }
    if (normalized.includes("dhl")) {
      return `https://www.dhl.com/us-en/home/tracking/tracking-express.html?submit=1&tracking-id=${encodedTracking}`;
    }

    return null;
  };

  function handleLogout() {
    if (signedOut) return;
    void logoutAction.run(async () => {
      setLogoutError(null);
      try {
        const response = await withRequestDeadline((signal) =>
          fetch("/api/auth/logout", { method: "POST", signal }),
        );
        if (!response.ok) throw new Error("Sign out failed");
        setSignedOut(true);
        notifySessionUpdate();
        router.replace("/");
        router.refresh();
      } catch {
        setSignedOut(false);
        setLogoutError("Could not sign out. Please try again.");
      }
    });
  }

  if (ownerChanged) return <AccountLoadError ownerChanged />;

  return (
    <div className="min-h-screen bg-[var(--storefront-surface)] text-black">
      <div className="mx-auto max-w-[92rem] px-5 pb-24 pt-12 sm:px-8 sm:pt-16 lg:px-12">
        <header className="border-b border-zinc-300 pb-8 sm:pb-10">
          <p className="text-[0.68rem] font-medium uppercase tracking-[0.3em] text-zinc-500">
            Customer account
          </p>
          <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <h1 className="text-4xl font-normal tracking-[-0.04em] sm:text-6xl">
              My Account
            </h1>
            <p className="break-all text-sm text-zinc-600 sm:text-base">{userEmail}</p>
          </div>
        </header>

        <div className="grid gap-12 pt-8 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-20 lg:pt-12">
          <aside className="lg:sticky lg:top-32 lg:h-fit">
            <nav
              aria-label="Account sections"
              className="flex flex-wrap gap-x-6 gap-y-3 lg:flex-col lg:items-start lg:gap-4"
            >
              <a href="#addresses" className={textButtonClassName}>
                Addresses
              </a>
              <a href="#orders" className={textButtonClassName}>
                Orders
              </a>
              <a href="#security" className={textButtonClassName}>
                Password
              </a>
            </nav>
            <div className="mt-8 hidden space-y-3 border-t border-zinc-300 pt-6 lg:block">
              <ActionButton
                type="button"
                onClick={handleLogout}
                pending={logoutAction.pending || signedOut}
                pendingLabel="Signing out…"
                className={textButtonClassName}
              >
                Sign out
              </ActionButton>
              {logoutError && <RequestError message={logoutError} />}
            </div>
          </aside>

          <div className="min-w-0">
            {!accountActionsAvailable && (
              <p role="status" className="mb-5 text-sm text-zinc-600">
                Verify your account session before making changes.
              </p>
            )}
            <section id="addresses" className="scroll-mt-36 pb-14">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-[0.68rem] uppercase tracking-[0.24em] text-zinc-500">
                    Checkout details
                  </p>
                  <h2 className="mt-2 text-2xl font-normal tracking-[-0.02em] sm:text-3xl">
                    Shipping Addresses
                  </h2>
                </div>
                <p className="max-w-md text-sm leading-6 text-zinc-500">
                  Save multiple addresses and choose the one used by default at checkout.
                </p>
              </div>

              <div className="mt-8 border-y border-zinc-300 py-6">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-[0.68rem] font-medium uppercase tracking-[0.18em] text-zinc-500">
                      Default shipping address
                    </p>
                    <ResourceError
                      label="your default shipping address"
                      resource={profileResource}
                    />
                    {!profile && !profileResource.error ? (
                      <ShippingProfileSkeleton />
                    ) : null}
                    {profile?.address_line1 ? (
                      <address className="mt-4 space-y-1 text-sm not-italic leading-6 text-zinc-700">
                        {profile.full_name ? (
                          <div className="font-semibold text-black">
                            {profile.full_name}
                          </div>
                        ) : null}
                        <div>{profile.address_line1}</div>
                        {profile.address_line2 ? (
                          <div>{profile.address_line2}</div>
                        ) : null}
                        <div>
                          {profile.city}, {profile.state} {profile.postal_code}
                        </div>
                        <div>{profile.country}</div>
                        {profile.phone ? (
                          <div className="text-zinc-500">{profile.phone}</div>
                        ) : null}
                      </address>
                    ) : profile ? (
                      <p className="mt-3 text-sm text-zinc-500">
                        No default address selected yet.
                      </p>
                    ) : null}
                  </div>
                  {profile?.address_line1 ? (
                    <ActionButton
                      type="button"
                      onClick={() => handleDefault(null, "clear")}
                      disabled={addressAction.pending || !addressActionsAvailable}
                      pending={addressAction.pending && addressOperation === "clear"}
                      pendingLabel="Clearing default…"
                      className={textButtonClassName}
                    >
                      Clear default
                    </ActionButton>
                  ) : null}
                </div>
              </div>

              <div className="mt-8">
                <h3 className="text-sm font-medium uppercase tracking-[0.12em]">
                  Saved Addresses
                </h3>
                {(addressResource.error === "sign-in" ||
                  (!unconfirmedSave && !addressRefreshNeeded)) && (
                  <ResourceError
                    label="your saved addresses"
                    resource={addressResource}
                  />
                )}
                {!addresses && !addressResource.error ? <AddressesSkeleton /> : null}
                {addresses?.length === 0 ? (
                  <p className="mt-5 border-t border-zinc-200 py-6 text-sm text-zinc-500">
                    No saved addresses yet.
                  </p>
                ) : addresses ? (
                  <div className="mt-5 grid border-t border-zinc-300 md:grid-cols-2">
                    {addresses.map((address, index) => (
                      <article
                        key={address.id}
                        className={`border-b border-zinc-300 py-6 md:px-6 ${
                          index % 2 === 0 ? "md:border-r md:pl-0" : "md:pr-0"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-5">
                          <address className="space-y-1 text-sm not-italic leading-6 text-zinc-700">
                            <div className="flex flex-wrap items-center gap-3 font-semibold text-black">
                              <span>{address.name || "Saved Address"}</span>
                              {isDefaultAddress(address) ? (
                                <span className="border border-zinc-300 px-2 py-0.5 text-[0.6rem] font-medium uppercase tracking-[0.14em] text-zinc-500">
                                  Default
                                </span>
                              ) : null}
                            </div>
                            <div>{address.line1}</div>
                            {address.line2 ? <div>{address.line2}</div> : null}
                            <div>
                              {address.city}, {address.state} {address.postal_code}
                            </div>
                            <div>{address.country}</div>
                            {address.phone ? (
                              <div className="text-zinc-500">{address.phone}</div>
                            ) : null}
                          </address>
                          <ActionButton
                            type="button"
                            onClick={() => handleDeleteAddress(address)}
                            disabled={
                              addressAction.pending ||
                              !profile ||
                              !addressActionsAvailable
                            }
                            pending={
                              addressAction.pending &&
                              addressOperation === `remove:${address.id}`
                            }
                            pendingLabel="Removing…"
                            className={textButtonClassName}
                          >
                            Remove
                          </ActionButton>
                        </div>
                        {profile && !isDefaultAddress(address) ? (
                          <ActionButton
                            type="button"
                            onClick={() => handleDefault(address, `set:${address.id}`)}
                            disabled={addressAction.pending || !savedDefaultAvailable}
                            pending={
                              addressAction.pending &&
                              addressOperation === `set:${address.id}`
                            }
                            pendingLabel="Setting default…"
                            className={`${textButtonClassName} mt-5`}
                          >
                            Set as default
                          </ActionButton>
                        ) : null}
                      </article>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="mt-5 space-y-4">
                <ActionResult result={addressResult} id="account-address-result" />
                {(unconfirmedSave || addressRefreshNeeded) && (
                  <ActionButton
                    type="button"
                    onClick={handleAddressCheck}
                    disabled={addressAction.pending || !accountActionsAvailable}
                    pending={
                      addressAction.pending && addressOperation === "check-address"
                    }
                    pendingLabel="Checking saved addresses…"
                    className={textButtonClassName}
                  >
                    {unconfirmedSave
                      ? "Check saved addresses"
                      : "Refresh saved addresses"}
                  </ActionButton>
                )}
                {showDefaultRetry && (
                  <div className="space-y-3">
                    <ActionResult
                      result={{ tone: "error", message: defaultRetry.message }}
                      id="account-default-result"
                    />
                    <ActionButton
                      type="button"
                      onClick={() => handleDefault(retryAddress ?? null, "retry-default")}
                      disabled={
                        addressAction.pending ||
                        !addressActionsAvailable ||
                        Boolean(retryAddress && !savedDefaultAvailable)
                      }
                      pending={
                        addressAction.pending && addressOperation === "retry-default"
                      }
                      pendingLabel="Retrying default update…"
                      className={textButtonClassName}
                    >
                      Retry default update
                    </ActionButton>
                  </div>
                )}
              </div>

              <form
                onSubmit={handleSaveAddress}
                aria-describedby={
                  addressResult?.tone === "error" ? "account-address-result" : undefined
                }
                className="mt-12 border-t border-zinc-300 pt-8"
              >
                <div className="mb-7">
                  <p className="text-[0.68rem] uppercase tracking-[0.24em] text-zinc-500">
                    New destination
                  </p>
                  <h3 className="mt-2 text-xl font-normal">Add an Address</h3>
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <label htmlFor="account-address-name" className={fieldLabelClassName}>
                      Full Name
                    </label>
                    <input
                      id="account-address-name"
                      name="name"
                      autoComplete="name"
                      readOnly={addressFormLocked}
                      type="text"
                      value={addressForm.name}
                      onChange={(event) =>
                        setAddressForm({ ...addressForm, name: event.target.value })
                      }
                      className={fieldClassName}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="account-address-phone"
                      className={fieldLabelClassName}
                    >
                      Phone
                    </label>
                    <input
                      id="account-address-phone"
                      name="phone"
                      autoComplete="tel"
                      readOnly={addressFormLocked}
                      type="tel"
                      value={addressForm.phone}
                      onChange={(event) =>
                        setAddressForm({ ...addressForm, phone: event.target.value })
                      }
                      className={fieldClassName}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label
                      htmlFor="account-address-line1"
                      className={fieldLabelClassName}
                    >
                      Address Line 1 *
                    </label>
                    <input
                      id="account-address-line1"
                      name="line1"
                      autoComplete="address-line1"
                      readOnly={addressFormLocked}
                      type="text"
                      required
                      value={addressForm.line1}
                      onChange={(event) =>
                        setAddressForm({ ...addressForm, line1: event.target.value })
                      }
                      className={fieldClassName}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label
                      htmlFor="account-address-line2"
                      className={fieldLabelClassName}
                    >
                      Apartment / Unit
                    </label>
                    <input
                      id="account-address-line2"
                      name="line2"
                      autoComplete="address-line2"
                      readOnly={addressFormLocked}
                      type="text"
                      value={addressForm.line2}
                      onChange={(event) =>
                        setAddressForm({ ...addressForm, line2: event.target.value })
                      }
                      className={fieldClassName}
                    />
                  </div>
                  <div>
                    <label htmlFor="account-address-city" className={fieldLabelClassName}>
                      City *
                    </label>
                    <input
                      id="account-address-city"
                      name="city"
                      autoComplete="address-level2"
                      readOnly={addressFormLocked}
                      type="text"
                      required
                      value={addressForm.city}
                      onChange={(event) =>
                        setAddressForm({ ...addressForm, city: event.target.value })
                      }
                      className={fieldClassName}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="account-address-state"
                      className={fieldLabelClassName}
                    >
                      State *
                    </label>
                    <input
                      id="account-address-state"
                      name="state"
                      autoComplete="address-level1"
                      readOnly={addressFormLocked}
                      type="text"
                      required
                      value={addressForm.state}
                      onChange={(event) =>
                        setAddressForm({ ...addressForm, state: event.target.value })
                      }
                      className={fieldClassName}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="account-address-postal_code"
                      className={fieldLabelClassName}
                    >
                      Postal Code *
                    </label>
                    <input
                      id="account-address-postal_code"
                      name="postal_code"
                      autoComplete="postal-code"
                      readOnly={addressFormLocked}
                      type="text"
                      required
                      value={addressForm.postal_code}
                      onChange={(event) =>
                        setAddressForm({
                          ...addressForm,
                          postal_code: event.target.value,
                        })
                      }
                      className={fieldClassName}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="account-address-country"
                      className={fieldLabelClassName}
                    >
                      Country *
                    </label>
                    <input
                      id="account-address-country"
                      name="country"
                      autoComplete="country-name"
                      readOnly={addressFormLocked}
                      type="text"
                      required
                      value={addressForm.country}
                      onChange={(event) =>
                        setAddressForm({ ...addressForm, country: event.target.value })
                      }
                      className={fieldClassName}
                    />
                  </div>
                </div>

                <label className="mt-6 flex items-center gap-3 text-sm text-zinc-600">
                  <input
                    type="checkbox"
                    checked={setAsDefault}
                    disabled={addressFormLocked}
                    onChange={(event) => setSetAsDefault(event.target.checked)}
                    className="h-4 w-4 accent-black"
                  />
                  Set as default shipping address
                </label>

                <ActionButton
                  type="submit"
                  disabled={addressAction.pending || !addressActionsAvailable}
                  pending={addressAction.pending && addressOperation === "add"}
                  pendingLabel="Saving address…"
                  className={`${primaryButtonClassName} mt-7`}
                >
                  Add Address
                </ActionButton>
              </form>
            </section>

            <section id="orders" className="scroll-mt-36 border-t border-zinc-300 py-14">
              <p className="text-[0.68rem] uppercase tracking-[0.24em] text-zinc-500">
                Purchase history
              </p>
              <h2 className="mt-2 text-2xl font-normal tracking-[-0.02em] sm:text-3xl">
                Orders
              </h2>

              <ResourceError label="your orders" resource={orderResource} />
              {!orders && !orderResource.error ? <OrdersSkeleton /> : null}
              {orders?.length === 0 ? (
                <div className="mt-8 border-y border-zinc-300 py-10">
                  <p className="text-sm text-zinc-500">
                    You have not placed an order yet.
                  </p>
                </div>
              ) : orders ? (
                <div className="mt-8 border-t border-zinc-300">
                  {orders.map((order) => {
                    const trackingUrl = getTrackingUrl(
                      order.shipping_carrier,
                      order.tracking_number,
                    );
                    const showTracking =
                      order.fulfillment === "ship" && order.tracking_number;

                    return (
                      <article key={order.id} className="border-b border-zinc-300 py-7">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div>
                            <h3 className="font-semibold">
                              Order #{order.id.slice(0, 8)}
                            </h3>
                            <p className="mt-1 text-sm text-zinc-500">
                              {new Date(order.created_at).toLocaleDateString()} &middot;{" "}
                              {order.status ?? "Processing"}
                            </p>
                          </div>
                          <p className="font-semibold">
                            ${Number(order.total ?? 0).toFixed(2)}
                          </p>
                        </div>
                        <div className="mt-5 space-y-2">
                          {(order.items || []).map((item) => (
                            <div
                              key={item.id}
                              className="flex items-start justify-between gap-5 text-sm text-zinc-600"
                            >
                              <span>
                                {item.product_name ?? item.product?.name ?? "Item"}
                                {item.size_label ? ` (${item.size_label})` : ""}
                              </span>
                              <span className="shrink-0">Qty. {item.quantity}</span>
                            </div>
                          ))}
                        </div>
                        {showTracking ? (
                          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 pt-5 text-sm text-zinc-500">
                            <span>
                              Tracking:{" "}
                              {order.shipping_carrier ? `${order.shipping_carrier} ` : ""}
                              <span className="text-zinc-800">
                                {order.tracking_number}
                              </span>
                            </span>
                            {trackingUrl ? (
                              <a
                                href={trackingUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={textButtonClassName}
                              >
                                Track shipment
                              </a>
                            ) : null}
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              ) : null}
            </section>

            <section
              id="security"
              className="scroll-mt-36 border-t border-zinc-300 py-14"
            >
              <p className="text-[0.68rem] uppercase tracking-[0.24em] text-zinc-500">
                Account security
              </p>
              <h2 className="mt-2 text-2xl font-normal tracking-[-0.02em] sm:text-3xl">
                Change Password
              </h2>

              <form onSubmit={handleChangePassword} className="mt-8 max-w-2xl space-y-5">
                <div>
                  <label htmlFor="account-new-password" className={fieldLabelClassName}>
                    New Password
                  </label>
                  <div className="relative">
                    <input
                      id="account-new-password"
                      name="password"
                      required
                      readOnly={passwordAction.pending}
                      aria-describedby={
                        passwordResult?.tone === "error"
                          ? "account-password-result"
                          : undefined
                      }
                      type={newPasswordVisible ? "text" : "password"}
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      autoComplete="new-password"
                      className={`${fieldClassName} pr-12`}
                    />
                    <ActionButton
                      type="button"
                      onClick={() => setNewPasswordVisible((visible) => !visible)}
                      className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-zinc-500 hover:text-black"
                      aria-label={newPasswordVisible ? "Hide password" : "Show password"}
                    >
                      {newPasswordVisible ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </ActionButton>
                  </div>
                </div>

                <PasswordRequirements password={newPassword} />

                <div>
                  <label
                    htmlFor="account-confirm-password"
                    className={fieldLabelClassName}
                  >
                    Confirm Password
                  </label>
                  <div className="relative">
                    <input
                      id="account-confirm-password"
                      name="confirm-password"
                      required
                      readOnly={passwordAction.pending}
                      aria-describedby={
                        passwordResult?.tone === "error"
                          ? "account-password-result"
                          : undefined
                      }
                      type={confirmPasswordVisible ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      autoComplete="new-password"
                      className={`${fieldClassName} pr-12`}
                    />
                    <ActionButton
                      type="button"
                      onClick={() => setConfirmPasswordVisible((visible) => !visible)}
                      className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-zinc-500 hover:text-black"
                      aria-label={
                        confirmPasswordVisible ? "Hide password" : "Show password"
                      }
                    >
                      {confirmPasswordVisible ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </ActionButton>
                  </div>
                </div>

                <ActionResult result={passwordResult} id="account-password-result" />
                <ActionButton
                  type="submit"
                  disabled={!accountActionsAvailable}
                  pending={passwordAction.pending}
                  pendingLabel="Changing password…"
                  className={primaryButtonClassName}
                >
                  Change Password
                </ActionButton>
              </form>
            </section>

            <section className="border-t border-zinc-300 pt-10 lg:hidden">
              <h2 className="text-xl font-normal">Sign Out</h2>
              <p className="mt-2 text-sm leading-6 text-zinc-500">
                You can sign back in anytime to view your orders and account details.
              </p>
              <ActionButton
                type="button"
                onClick={handleLogout}
                pending={logoutAction.pending || signedOut}
                pendingLabel="Signing out…"
                className={`${primaryButtonClassName} mt-6`}
              >
                Sign out
              </ActionButton>
              {logoutError && (
                <div className="mt-3">
                  <RequestError message={logoutError} />
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
