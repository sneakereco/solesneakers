"use client";

import { ActionButton } from "./ActionButton";

type RequestErrorProps = {
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
  signInHref?: string;
};

export function RequestError({
  message,
  onRetry,
  retrying,
  signInHref,
}: RequestErrorProps) {
  return (
    <div className="space-y-3 text-sm text-zinc-700">
      <p role="alert">{message}</p>
      {(onRetry || signInHref) && (
        <div className="flex flex-wrap items-center gap-3">
          {onRetry && (
            <ActionButton
              type="button"
              variant="secondary"
              onClick={onRetry}
              pending={retrying}
              pendingLabel="Retrying…"
            >
              Retry
            </ActionButton>
          )}
          {signInHref && (
            <a
              href={signInHref}
              className="font-semibold text-zinc-950 underline underline-offset-4"
            >
              Sign in
            </a>
          )}
        </div>
      )}
    </div>
  );
}
