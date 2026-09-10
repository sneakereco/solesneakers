import { useEffect, useRef, useState } from "react";

import type {
  SquareCardInputEvent,
  SquarePaymentMethod,
  SquareTokenResult,
} from "@/lib/square/web-payments";

const messages: Record<string, string> = {
  cardNumber: "Enter a valid card number",
  expirationDate: "Enter a valid expiration date",
  cvv: "Enter the CVV or security code on your card",
  postalCode: "Enter a valid card billing ZIP / postal code",
};

export function useSquareCardState(
  card: SquarePaymentMethod | null,
  onSubmit: () => void,
) {
  const [brand, setBrand] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const nativeErrors = useRef<Record<string, boolean>>({});
  const submit = useRef(onSubmit);
  submit.current = onSubmit;
  useEffect(() => {
    nativeErrors.current = {};
    setBrand(null);
    setErrors({});
    if (!card?.addEventListener) {
      return;
    }
    const update = (event: SquareCardInputEvent, blurred = false) => {
      const { field, currentState } = event.detail;
      if (!field || !messages[field] || !currentState) {
        return;
      }
      nativeErrors.current[field] = Boolean(currentState.hasErrorClass);
      if (field === "cardNumber" && currentState.isEmpty) {
        setBrand(null);
      }
      setErrors((previous) => {
        const next = { ...previous };
        if (currentState.isCompletelyValid || currentState.hasErrorClass) {
          delete next[field];
        } else if (blurred) {
          next[field] = messages[field];
        }
        return next;
      });
    };
    const listeners: Record<string, (event: SquareCardInputEvent) => void> = {
      cardBrandChanged: (event) => {
        setBrand(event.detail.cardBrand ?? null);
        update(event);
      },
      focusClassAdded: (event) => update(event),
      focusClassRemoved: (event) => update(event, true),
      errorClassAdded: (event) => update(event),
      errorClassRemoved: (event) => update(event),
      submit: (event) => {
        update(event);
        submit.current();
      },
    };
    for (const [name, callback] of Object.entries(listeners)) {
      card.addEventListener(name, callback);
    }
    return () => {
      for (const [name, callback] of Object.entries(listeners)) {
        card.removeEventListener?.(name, callback);
      }
    };
  }, [card]);

  function showTokenErrors(tokenErrors: SquareTokenResult["errors"]) {
    const next: Record<string, string> = {};
    for (const error of tokenErrors ?? []) {
      if (error.field && messages[error.field] && !nativeErrors.current[error.field]) {
        next[error.field] = messages[error.field];
      }
    }
    if (!Object.keys(next).length && !Object.values(nativeErrors.current).some(Boolean)) {
      next.cardNumber = "Check your card details and try again";
    }
    setErrors(next);
    const firstError =
      Object.keys(next)[0] ??
      Object.keys(nativeErrors.current).find((field) => nativeErrors.current[field]);
    if (firstError) {
      void card?.focus?.(firstError);
    }
  }
  return { brand, errors, showTokenErrors };
}
