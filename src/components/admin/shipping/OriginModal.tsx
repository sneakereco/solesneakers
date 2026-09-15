"use client";

import { ModalPortal } from "@/components/ui/ModalPortal";

import type { ShippingOrigin } from "../../../types/domain/shipping";

type OriginErrors = Partial<Record<keyof ShippingOrigin, string>>;

type OriginModalProps = {
  open: boolean;
  originAddress: ShippingOrigin | null;
  emptyOrigin: ShippingOrigin;
  originError: string;
  originMessage: string;
  originFieldErrors?: OriginErrors;
  savingOrigin: boolean;
  onClose: () => void;
  onChange: (field: keyof ShippingOrigin, value: string) => void;
  onSave: () => void;
};

export function OriginModal({
  open,
  originAddress,
  emptyOrigin,
  originError,
  originMessage,
  originFieldErrors,
  savingOrigin,
  onClose,
  onChange,
  onSave,
}: OriginModalProps) {
  const value = originAddress ?? emptyOrigin;
  const errors = originFieldErrors ?? {};

  return (
    <ModalPortal open={open} onClose={onClose}>
      <div className="w-full max-w-3xl rounded-sm border border-zinc-800/70 bg-zinc-950 p-3 sm:p-6">
        <div className="mb-2 flex items-center justify-between gap-3 sm:mb-4">
          <div>
            <h2 className="text-sm font-semibold text-white sm:text-lg">
              Change origin address
            </h2>
            <p className="hidden text-[12px] text-zinc-400 sm:block sm:text-sm">
              Update the address used to create shipping labels.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[11px] text-zinc-400 hover:text-white sm:text-sm"
          >
            Close
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 text-[11px] sm:gap-4 sm:text-sm md:grid-cols-2">
          <div className="col-span-2 text-[10px] text-zinc-400 sm:text-xs">
            Provide a contact name or company name. Phone number is optional.
          </div>
          <div>
            <label className="mb-0.5 block text-gray-400">Contact name</label>
            <input
              type="text"
              value={value.name ?? ""}
              onChange={(e) => onChange("name", e.target.value)}
              className={`w-full border bg-zinc-900 px-2 py-1.5 text-white ${
                errors.name ? "border-red-500" : "border-zinc-800/70"
              }`}
            />
            {errors.name && (
              <div className="mt-1 text-[10px] text-red-400">{errors.name}</div>
            )}
          </div>
          <div>
            <label className="mb-0.5 block text-gray-400">Company</label>
            <input
              type="text"
              value={value.company ?? ""}
              onChange={(e) => onChange("company", e.target.value)}
              className={`w-full border bg-zinc-900 px-2 py-1.5 text-white ${
                errors.company ? "border-red-500" : "border-zinc-800/70"
              }`}
            />
            {errors.company && (
              <div className="mt-1 text-[10px] text-red-400">{errors.company}</div>
            )}
          </div>
          <div>
            <label className="mb-0.5 block text-gray-400">Phone (optional)</label>
            <input
              type="text"
              value={value.phone ?? ""}
              onChange={(e) => onChange("phone", e.target.value)}
              className={`w-full border bg-zinc-900 px-2 py-1.5 text-white ${
                errors.phone ? "border-red-500" : "border-zinc-800/70"
              }`}
            />
            {errors.phone && (
              <div className="mt-1 text-[10px] text-red-400">{errors.phone}</div>
            )}
          </div>
          <div>
            <label className="mb-0.5 block text-gray-400">Line 1</label>
            <input
              type="text"
              value={value.line1}
              onChange={(e) => onChange("line1", e.target.value)}
              className={`w-full border bg-zinc-900 px-2 py-1.5 text-white ${
                errors.line1 ? "border-red-500" : "border-zinc-800/70"
              }`}
            />
            {errors.line1 && (
              <div className="mt-1 text-[10px] text-red-400">{errors.line1}</div>
            )}
          </div>
          <div>
            <label className="mb-0.5 block text-gray-400">Line 2</label>
            <input
              type="text"
              value={value.line2 ?? ""}
              onChange={(e) => onChange("line2", e.target.value)}
              className={`w-full border bg-zinc-900 px-2 py-1.5 text-white ${
                errors.line2 ? "border-red-500" : "border-zinc-800/70"
              }`}
            />
            {errors.line2 && (
              <div className="mt-1 text-[10px] text-red-400">{errors.line2}</div>
            )}
          </div>
          <div>
            <label className="mb-0.5 block text-gray-400">City</label>
            <input
              type="text"
              value={value.city}
              onChange={(e) => onChange("city", e.target.value)}
              className={`w-full border bg-zinc-900 px-2 py-1.5 text-white ${
                errors.city ? "border-red-500" : "border-zinc-800/70"
              }`}
            />
            {errors.city && (
              <div className="mt-1 text-[10px] text-red-400">{errors.city}</div>
            )}
          </div>
          <div>
            <label className="mb-0.5 block text-gray-400">State</label>
            <input
              type="text"
              value={value.state}
              onChange={(e) => onChange("state", e.target.value)}
              className={`w-full border bg-zinc-900 px-2 py-1.5 text-white ${
                errors.state ? "border-red-500" : "border-zinc-800/70"
              }`}
            />
            {errors.state && (
              <div className="mt-1 text-[10px] text-red-400">{errors.state}</div>
            )}
          </div>
          <div>
            <label className="mb-0.5 block text-gray-400">Postal Code</label>
            <input
              type="text"
              value={value.postal_code}
              onChange={(e) => onChange("postal_code", e.target.value)}
              className={`w-full border bg-zinc-900 px-2 py-1.5 text-white ${
                errors.postal_code ? "border-red-500" : "border-zinc-800/70"
              }`}
            />
            {errors.postal_code && (
              <div className="mt-1 text-[10px] text-red-400">{errors.postal_code}</div>
            )}
          </div>
          <div>
            <label className="mb-0.5 block text-gray-400">Country</label>
            <input
              type="text"
              value={value.country}
              onChange={(e) => onChange("country", e.target.value)}
              className={`w-full border bg-zinc-900 px-2 py-1.5 text-white ${
                errors.country ? "border-red-500" : "border-zinc-800/70"
              }`}
            />
            {errors.country && (
              <div className="mt-1 text-[10px] text-red-400">{errors.country}</div>
            )}
          </div>
        </div>

        {(originError || originMessage) && (
          <div
            className={`mt-4 text-sm ${originError ? "text-red-400" : "text-green-400"}`}
          >
            {originError || originMessage}
          </div>
        )}

        <div className="mt-3 flex items-center justify-end gap-2 sm:mt-6 sm:gap-3">
          <button
            type="button"
            onClick={onClose}
            className="border border-zinc-800/70 px-3 py-1.5 text-[11px] text-gray-300 sm:px-4 sm:py-2 sm:text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={savingOrigin}
            className="bg-red-600 px-3 py-1.5 text-[11px] text-white hover:bg-red-500 disabled:bg-zinc-700 sm:px-4 sm:py-2 sm:text-sm"
          >
            {savingOrigin ? "Saving..." : "Save origin"}
          </button>
        </div>
      </div>
    </ModalPortal>
  );
}
