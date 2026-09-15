"use client";

import { createPortal } from "react-dom";
import { useEffect } from "react";
import { useHydrated } from "@/components/ui/useHydrated";
import { CheckCircle, AlertTriangle, X } from "lucide-react";

export interface AddressSuggestion {
  line1: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
}

interface AddressSuggestionModalProps {
  isOpen: boolean;
  isValid: boolean; // true = verified with suggestions, false = invalid with alternatives
  suggestions: AddressSuggestion[];
  originalAddress: {
    line1: string;
    city: string;
    state: string;
    postal_code: string;
  };
  onUseSuggestion: (suggestion: AddressSuggestion) => void;
  onUseOriginal: () => void;
  onCancel: () => void;
}

export function AddressSuggestionModal({
  isOpen,
  isValid,
  suggestions,
  originalAddress,
  onUseSuggestion,
  onUseOriginal,
  onCancel,
}: AddressSuggestionModalProps) {
  const mounted = useHydrated();

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }

    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!mounted || !isOpen) {
    return null;
  }

  const modal = (
    <div
      className="fixed bottom-0 left-0 right-0 top-0 z-[9999] flex h-[100svh] w-screen items-center justify-center bg-black/90 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onCancel();
        }
      }}
      role="dialog"
      aria-modal="true"
      style={{ zIndex: 9999 }}
    >
      <div
        className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        style={{ zIndex: 10000 }}
      >
        {/* Header */}
        <div className="sticky top-0 flex items-center justify-between border-b border-zinc-800 bg-zinc-900 p-4">
          <div className="flex items-center gap-2">
            {isValid ? (
              <CheckCircle className="h-5 w-5 text-green-400" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-yellow-400" />
            )}
            <h3 className="text-lg font-semibold text-white">
              {isValid ? "Address Verified" : "Address Suggestions"}
            </h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="p-1 text-gray-400 transition hover:text-white"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-4 p-4">
          <div className={`text-sm ${isValid ? "text-white" : "text-yellow-300"}`}>
            {isValid
              ? "We verified your address and found a standardized format."
              : "We couldn't verify the exact address you entered. Please review the suggestion below."}
          </div>

          {/* Original Address */}
          <div>
            <div className="mb-1 text-xs font-medium text-gray-400">You entered:</div>
            <div className="rounded border border-zinc-800 bg-zinc-950 p-3 text-sm text-gray-300">
              {originalAddress.line1}
              <br />
              {originalAddress.city}, {originalAddress.state}{" "}
              {originalAddress.postal_code}
            </div>
          </div>

          {/* Suggested Address */}
          <div>
            <div className="mb-1 text-xs font-medium text-gray-400">
              {isValid ? "Standardized format:" : "Suggested address:"}
            </div>
            <div className="rounded border border-red-600/50 bg-zinc-950 p-3 text-sm text-white">
              {suggestions[0].line1}
              <br />
              {suggestions[0].city}, {suggestions[0].state} {suggestions[0].postal_code}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 flex flex-col gap-3 border-t border-zinc-800 bg-zinc-900 p-4">
          <button
            type="button"
            onClick={() => onUseSuggestion(suggestions[0])}
            className="w-full rounded bg-red-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-red-700"
          >
            Use Standardized Address
          </button>
          <button
            type="button"
            onClick={onUseOriginal}
            className="w-full rounded bg-zinc-800 px-4 py-3 text-sm font-semibold text-white transition hover:bg-zinc-700"
          >
            Use Original Address
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
