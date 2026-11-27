import type { ComponentPropsWithRef } from "react";

type ActionButtonProps = ComponentPropsWithRef<"button"> & {
  pending?: boolean;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
};

export function ActionButton({
  pending = false,
  pendingLabel,
  variant,
  disabled,
  children,
  "aria-busy": ariaBusy,
  ...props
}: ActionButtonProps) {
  return (
    <button
      {...props}
      data-ui-action-button
      data-ui-action-pending={pending || undefined}
      data-ui-action-variant={variant}
      disabled={pending || disabled}
      aria-busy={pending || ariaBusy}
    >
      {pendingLabel ? (
        <span data-ui-action-content>
          <span aria-hidden={pending || undefined}>{children}</span>
          <span aria-hidden={!pending || undefined}>{pendingLabel}</span>
        </span>
      ) : (
        children
      )}
    </button>
  );
}
