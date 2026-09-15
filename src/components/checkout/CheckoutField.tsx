"use client";

import { Children, cloneElement, isValidElement, useId, useState } from "react";
import type { ChangeEvent, FocusEvent, FormEvent, ReactElement, ReactNode } from "react";

type Field = HTMLInputElement | HTMLSelectElement;
type FieldProps = {
  id?: string;
  className?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "data-checkout-error"?: string;
  onChange?: (event: ChangeEvent<Field>) => void;
  onBlur?: (event: FocusEvent<Field>) => void;
  onInvalid?: (event: FormEvent<Field>) => void;
};

function updateValidity(field: Field) {
  field.setCustomValidity("");
  const value = field.value.trim();
  const min = Number(field.getAttribute("minlength") ?? 0);
  const max = Number(field.getAttribute("maxlength") ?? Infinity);
  if (
    (field.required && !value) ||
    (value && (value.length < min || value.length > max)) ||
    (value &&
      field instanceof HTMLInputElement &&
      field.type === "tel" &&
      (!/^[+()\d.\s-]+$/.test(value) || value.replace(/\D/g, "").length < 7)) ||
    (value &&
      field instanceof HTMLInputElement &&
      field.type === "email" &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
  ) {
    field.setCustomValidity(field.dataset.checkoutError ?? "Check this field");
  }
  return field.validity.valid;
}

export function validateCheckoutFields(root: HTMLElement | null): boolean {
  let firstInvalid: Field | undefined;
  root?.querySelectorAll<Field>("[data-checkout-error]").forEach((field) => {
    if (field.disabled || field.closest("[inert], [hidden]")) {
      return;
    }
    updateValidity(field);
    if (!field.checkValidity()) {
      firstInvalid ??= field;
    }
  });
  firstInvalid?.focus();
  return !firstInvalid;
}

// One wrapper keeps field errors outside the input/icon layout in every checkout section.
export function CheckoutField({
  children,
  errorMessage,
}: {
  children: ReactNode;
  errorMessage: string;
}) {
  const errorId = useId();
  const [invalid, setInvalid] = useState(false);
  return (
    <div className="min-w-0">
      <div className="relative">
        {Children.map(children, (child) => {
          if (
            !isValidElement(child) ||
            (child.type !== "input" && child.type !== "select")
          ) {
            return child;
          }
          const field = child as ReactElement<FieldProps>;
          return cloneElement(field, {
            "data-checkout-error": errorMessage,
            "aria-invalid": invalid || undefined,
            "aria-describedby":
              [field.props["aria-describedby"], invalid ? errorId : null]
                .filter(Boolean)
                .join(" ") || undefined,
            onBlur: (event) => {
              setInvalid(!updateValidity(event.currentTarget));
              field.props.onBlur?.(event);
            },
            onChange: (event) => {
              const valid = updateValidity(event.currentTarget);
              if (valid) {
                setInvalid(false);
              }
              field.props.onChange?.(event);
            },
            onInvalid: (event) => {
              event.preventDefault();
              setInvalid(true);
              field.props.onInvalid?.(event);
            },
          });
        })}
      </div>
      {invalid && (
        <p
          id={errorId}
          className="mt-1.5 text-sm leading-5 text-[#d92d39]"
          aria-live="polite"
        >
          {errorMessage}
        </p>
      )}
    </div>
  );
}
