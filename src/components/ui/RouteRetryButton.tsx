"use client";

import { useTransition } from "react";
import { ActionButton } from "./ActionButton";

export function RouteRetryButton({
  retry,
  className,
}: {
  retry: () => void;
  className: string;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <ActionButton
      type="button"
      className={className}
      pending={pending}
      pendingLabel="Retrying…"
      onClick={() => startTransition(retry)}
    >
      Try again
    </ActionButton>
  );
}
