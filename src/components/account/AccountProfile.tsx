// src/components/account/AccountProfile.tsx
"use client";

import { useState, useEffect } from "react";
import { Eye, EyeOff } from "lucide-react";

import type { Tables } from "@/types/db/database.types";
import { logError } from "@/lib/utils/log";
import { PasswordRequirements } from "@/components/auth/register/PasswordRequirements";
import { isPasswordValid } from "@/lib/validation/password";
import { Toast } from "@/components/ui/Toast";

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

type AddressInput = Omit<AccountAddress, "id"> & { id?: string };

const fieldClassName =
  "h-12 w-full border border-zinc-300 bg-white px-4 text-[0.95rem] text-zinc-900 transition-colors placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none disabled:cursor-not-allowed disabled:bg-zinc-100";
const fieldLabelClassName =
  "mb-2 block text-[0.7rem] font-medium uppercase tracking-[0.16em] text-zinc-500";
const primaryButtonClassName =
  "inline-flex min-h-12 items-center justify-center bg-[#1f1f1d] px-6 text-xs font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-50";
const textButtonClassName =
  "text-xs font-medium uppercase tracking-[0.1em] text-zinc-500 transition-colors hover:text-black disabled:cursor-not-allowed disabled:opacity-50";

export function AccountProfile({ userEmail }: { userEmail: string }) {
  const [profile, setProfile] = useState<Partial<ShippingProfile>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [newPasswordVisible, setNewPasswordVisible] = useState(false);
  const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    tone: "success" | "error" | "info";
  } | null>(null);
  const [orders, setOrders] = useState<AccountOrder[]>([]);
  const [isOrdersLoading, setIsOrdersLoading] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [addresses, setAddresses] = useState<AccountAddress[]>([]);
  const [isAddressesLoading, setIsAddressesLoading] = useState(false);
  const [isAddressSaving, setIsAddressSaving] = useState(false);
  const [isDefaultSaving, setIsDefaultSaving] = useState(false);
  const [setAsDefault, setSetAsDefault] = useState(false);
  const [addressForm, setAddressForm] = useState({
    name: "",
    phone: "",
    line1: "",
    line2: "",
    city: "",
    state: "",
    postal_code: "",
    country: "",
  });

  useEffect(() => {
    loadProfile();
    loadOrders();
    loadAddresses();
  }, []);

  const loadProfile = async () => {
    try {
      const response = await fetch("/api/account/shipping");
      const data = await response.json();
      setProfile(data);
    } catch (error) {
      logError(error, { layer: "frontend", event: "account_load_profile" });
    }
  };

  const loadOrders = async () => {
    setIsOrdersLoading(true);
    try {
      const response = await fetch("/api/account/orders");
      const data = await response.json();
      setOrders(data.orders || []);
    } catch (error) {
      logError(error, { layer: "frontend", event: "account_load_orders" });
    } finally {
      setIsOrdersLoading(false);
    }
  };

  const formatField = (value?: string | null) => (value ?? "").trim().toLowerCase();

  const isDefaultAddress = (address: AccountAddress) => {
    if (!profile.address_line1) {
      return false;
    }
    return (
      formatField(profile.address_line1) === formatField(address.line1) &&
      formatField(profile.address_line2) === formatField(address.line2) &&
      formatField(profile.city) === formatField(address.city) &&
      formatField(profile.state) === formatField(address.state) &&
      formatField(profile.postal_code) === formatField(address.postal_code) &&
      formatField(profile.country) === formatField(address.country)
    );
  };

  const handleSetDefaultAddress = async (address: AddressInput, silent?: boolean) => {
    setIsDefaultSaving(true);
    if (!silent) {
      setMessage("");
    }

    try {
      const response = await fetch("/api/account/shipping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: address.name ?? null,
          phone: address.phone ?? null,
          address_line1: address.line1 ?? null,
          address_line2: address.line2 ?? null,
          city: address.city ?? null,
          state: address.state ?? null,
          postal_code: address.postal_code ?? null,
          country: address.country ?? null,
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        if (!silent) {
          setMessage(data?.error ?? "Failed to set default shipping address");
        }
        return;
      }

      setProfile(data || {});
      if (!silent) {
        setMessage("Default shipping address updated successfully.");
      }
    } catch {
      if (!silent) {
        setMessage("Error updating default shipping address");
      }
    } finally {
      setIsDefaultSaving(false);
    }
  };

  const handleClearDefaultShipping = async (silent?: boolean) => {
    setIsDefaultSaving(true);
    if (!silent) {
      setMessage("");
    }

    try {
      const response = await fetch("/api/account/shipping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: null,
          phone: null,
          address_line1: null,
          address_line2: null,
          city: null,
          state: null,
          postal_code: null,
          country: null,
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        if (!silent) {
          setMessage(data?.error ?? "Failed to clear default shipping address");
        }
        return;
      }

      setProfile(data || {});
      if (!silent) {
        setMessage("Default shipping address cleared successfully.");
      }
    } catch {
      if (!silent) {
        setMessage("Error clearing default shipping address");
      }
    } finally {
      setIsDefaultSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setMessage("");

    if (newPassword !== confirmPassword) {
      setMessage("Passwords do not match");
      setIsLoading(false);
      return;
    }

    if (!isPasswordValid(newPassword)) {
      setMessage("Password does not meet the required criteria.");
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPassword }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setMessage(`Failed to change password: ${data?.error ?? "Unknown error"}`);
      } else {
        setToast({ message: "Password changed successfully!", tone: "success" });
        setNewPassword("");
        setConfirmPassword("");
        setNewPasswordVisible(false);
        setConfirmPasswordVisible(false);
      }
    } catch {
      setMessage("Error changing password");
    } finally {
      setIsLoading(false);
    }
  };

  const loadAddresses = async () => {
    setIsAddressesLoading(true);
    try {
      const response = await fetch("/api/account/addresses");
      const data = await response.json();
      setAddresses(data.addresses || []);
    } catch (error) {
      logError(error, { layer: "frontend", event: "account_load_addresses" });
    } finally {
      setIsAddressesLoading(false);
    }
  };

  const handleSaveAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAddressSaving(true);
    setMessage("");
    const addressPayload = { ...addressForm };

    try {
      const response = await fetch("/api/account/addresses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(addressForm),
      });

      if (!response.ok) {
        setMessage("Failed to save address");
        return;
      }

      const data = await response.json();
      setAddresses(data.addresses || []);
      setAddressForm({
        name: "",
        phone: "",
        line1: "",
        line2: "",
        city: "",
        state: "",
        postal_code: "",
        country: "",
      });
      if (setAsDefault) {
        await handleSetDefaultAddress(
          {
            name: addressPayload.name,
            phone: addressPayload.phone,
            line1: addressPayload.line1,
            line2: addressPayload.line2,
            city: addressPayload.city,
            state: addressPayload.state,
            postal_code: addressPayload.postal_code,
            country: addressPayload.country,
          },
          true,
        );
      }
      setSetAsDefault(false);
      setMessage(
        setAsDefault
          ? "Address saved successfully and set as default shipping."
          : "Address saved successfully!",
      );
    } catch {
      setMessage("Error saving address");
    } finally {
      setIsAddressSaving(false);
    }
  };

  const handleDeleteAddress = async (addressId: string) => {
    setMessage("");
    const targetAddress = addresses.find((address) => address.id === addressId);
    const wasDefault = targetAddress ? isDefaultAddress(targetAddress) : false;
    try {
      const response = await fetch(`/api/account/addresses/${addressId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        setMessage("Failed to remove address");
        return;
      }

      setAddresses((prev) => prev.filter((address) => address.id !== addressId));
      if (wasDefault) {
        await handleClearDefaultShipping(true);
      }
    } catch {
      setMessage("Error removing address");
    }
  };

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

  const handleLogout = async () => {
    setIsSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      window.location.href = "/";
    } catch {
      setMessage("Failed to log out. Please try again.");
    } finally {
      setIsSigningOut(false);
    }
  };

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
            <div className="mt-8 hidden border-t border-zinc-300 pt-6 lg:block">
              <button
                type="button"
                onClick={() => void handleLogout()}
                disabled={isSigningOut}
                className={textButtonClassName}
              >
                {isSigningOut ? "Signing out..." : "Sign out"}
              </button>
            </div>
          </aside>

          <div className="min-w-0">
            {message ? (
              <div
                role="status"
                className={`mb-8 border px-5 py-4 text-sm ${
                  message.includes("success")
                    ? "border-emerald-200 bg-[#f7fbf8] text-emerald-700"
                    : "border-red-200 bg-[#fff8f8] text-red-700"
                }`}
              >
                {message}
              </div>
            ) : null}

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
                    {profile.address_line1 ? (
                      <address className="mt-4 space-y-1 not-italic text-sm leading-6 text-zinc-700">
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
                    ) : (
                      <p className="mt-3 text-sm text-zinc-500">
                        No default address selected yet.
                      </p>
                    )}
                  </div>
                  {profile.address_line1 ? (
                    <button
                      type="button"
                      onClick={() => void handleClearDefaultShipping()}
                      disabled={isDefaultSaving}
                      className={textButtonClassName}
                    >
                      {isDefaultSaving ? "Updating..." : "Clear default"}
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="mt-8">
                <h3 className="text-sm font-medium uppercase tracking-[0.12em]">
                  Saved Addresses
                </h3>
                {isAddressesLoading ? (
                  <p className="mt-5 text-sm text-zinc-500">Loading addresses...</p>
                ) : addresses.length === 0 ? (
                  <p className="mt-5 border-t border-zinc-200 py-6 text-sm text-zinc-500">
                    No saved addresses yet.
                  </p>
                ) : (
                  <div className="mt-5 grid border-t border-zinc-300 md:grid-cols-2">
                    {addresses.map((address, index) => (
                      <article
                        key={address.id}
                        className={`border-b border-zinc-300 py-6 md:px-6 ${
                          index % 2 === 0 ? "md:border-r md:pl-0" : "md:pr-0"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-5">
                          <address className="space-y-1 not-italic text-sm leading-6 text-zinc-700">
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
                          <button
                            type="button"
                            onClick={() => void handleDeleteAddress(address.id)}
                            className={textButtonClassName}
                          >
                            Remove
                          </button>
                        </div>
                        {!isDefaultAddress(address) ? (
                          <button
                            type="button"
                            onClick={() => void handleSetDefaultAddress(address)}
                            disabled={isDefaultSaving}
                            className={`${textButtonClassName} mt-5`}
                          >
                            {isDefaultSaving ? "Updating..." : "Set as default"}
                          </button>
                        ) : null}
                      </article>
                    ))}
                  </div>
                )}
              </div>

              <form
                onSubmit={(event) => void handleSaveAddress(event)}
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
                    <label className={fieldLabelClassName}>Full Name</label>
                    <input
                      type="text"
                      value={addressForm.name}
                      onChange={(event) =>
                        setAddressForm({ ...addressForm, name: event.target.value })
                      }
                      className={fieldClassName}
                    />
                  </div>
                  <div>
                    <label className={fieldLabelClassName}>Phone</label>
                    <input
                      type="tel"
                      value={addressForm.phone}
                      onChange={(event) =>
                        setAddressForm({ ...addressForm, phone: event.target.value })
                      }
                      className={fieldClassName}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className={fieldLabelClassName}>Address Line 1 *</label>
                    <input
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
                    <label className={fieldLabelClassName}>Apartment / Unit</label>
                    <input
                      type="text"
                      value={addressForm.line2}
                      onChange={(event) =>
                        setAddressForm({ ...addressForm, line2: event.target.value })
                      }
                      className={fieldClassName}
                    />
                  </div>
                  <div>
                    <label className={fieldLabelClassName}>City *</label>
                    <input
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
                    <label className={fieldLabelClassName}>State *</label>
                    <input
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
                    <label className={fieldLabelClassName}>Postal Code *</label>
                    <input
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
                    <label className={fieldLabelClassName}>Country *</label>
                    <input
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
                    onChange={(event) => setSetAsDefault(event.target.checked)}
                    className="h-4 w-4 accent-black"
                  />
                  Set as default shipping address
                </label>

                <button
                  type="submit"
                  disabled={isAddressSaving}
                  className={`${primaryButtonClassName} mt-7`}
                >
                  {isAddressSaving ? "Saving..." : "Add Address"}
                </button>
              </form>
            </section>

            <section id="orders" className="scroll-mt-36 border-t border-zinc-300 py-14">
              <p className="text-[0.68rem] uppercase tracking-[0.24em] text-zinc-500">
                Purchase history
              </p>
              <h2 className="mt-2 text-2xl font-normal tracking-[-0.02em] sm:text-3xl">
                Orders
              </h2>

              {isOrdersLoading ? (
                <p className="mt-8 text-sm text-zinc-500">Loading orders...</p>
              ) : orders.length === 0 ? (
                <div className="mt-8 border-y border-zinc-300 py-10">
                  <p className="text-sm text-zinc-500">
                    You have not placed an order yet.
                  </p>
                </div>
              ) : (
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
              )}
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

              <form
                onSubmit={(event) => void handleChangePassword(event)}
                className="mt-8 max-w-2xl space-y-5"
              >
                <div>
                  <label className={fieldLabelClassName}>New Password</label>
                  <div className="relative">
                    <input
                      type={newPasswordVisible ? "text" : "password"}
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      autoComplete="new-password"
                      className={`${fieldClassName} pr-12`}
                    />
                    <button
                      type="button"
                      onClick={() => setNewPasswordVisible((visible) => !visible)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400 transition-colors hover:text-black"
                      aria-label={newPasswordVisible ? "Hide password" : "Show password"}
                    >
                      {newPasswordVisible ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                <PasswordRequirements password={newPassword} />

                <div>
                  <label className={fieldLabelClassName}>Confirm Password</label>
                  <div className="relative">
                    <input
                      type={confirmPasswordVisible ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      autoComplete="new-password"
                      className={`${fieldClassName} pr-12`}
                    />
                    <button
                      type="button"
                      onClick={() => setConfirmPasswordVisible((visible) => !visible)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400 transition-colors hover:text-black"
                      aria-label={
                        confirmPasswordVisible ? "Hide password" : "Show password"
                      }
                    >
                      {confirmPasswordVisible ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className={primaryButtonClassName}
                >
                  {isLoading ? "Changing..." : "Change Password"}
                </button>
              </form>
            </section>

            <section className="border-t border-zinc-300 pt-10 lg:hidden">
              <h2 className="text-xl font-normal">Sign Out</h2>
              <p className="mt-2 text-sm leading-6 text-zinc-500">
                You can sign back in anytime to view your orders and account details.
              </p>
              <button
                type="button"
                onClick={() => void handleLogout()}
                disabled={isSigningOut}
                className={`${primaryButtonClassName} mt-6`}
              >
                {isSigningOut ? "Signing out..." : "Sign out"}
              </button>
            </section>
          </div>
        </div>
      </div>

      <Toast
        open={Boolean(toast)}
        message={toast?.message ?? ""}
        tone={toast?.tone ?? "info"}
        onClose={() => setToast(null)}
      />
    </div>
  );
}
