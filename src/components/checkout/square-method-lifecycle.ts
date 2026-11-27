import type { SquarePaymentRequest } from "@/lib/square/web-payments";

import { withRequestDeadline } from "@/lib/http/request-deadline";

// Attach each generation to its own host. An abandoned SDK call may still
// allocate resources when it eventually settles.
export function createSquareMethodLifecycle<
  T extends { destroy?(): Promise<boolean> },
>() {
  let release: (() => Promise<void>) | undefined;

  function dispose() {
    const retire = release;
    release = undefined;
    return retire?.() ?? Promise.resolve();
  }

  async function replace(
    create: () => Promise<T>,
    attach: (method: T, current: () => boolean) => Promise<void>,
  ) {
    const previous = dispose();
    const controller = new AbortController();
    let method: T | undefined;
    const retire = async () => {
      controller.abort();
      await method?.destroy?.();
    };
    release = retire;
    // Cleanup of a retired generation must not block the new host.
    void previous.catch(() => undefined);
    try {
      await withRequestDeadline(async (signal) => {
        const current = () => !signal.aborted && !controller.signal.aborted;
        const instance = await create();
        method = instance;
        if (!current()) {
          await instance.destroy?.();
          return;
        }
        try {
          await attach(instance, current);
        } finally {
          if (!current()) await instance.destroy?.();
        }
      }, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (release === retire) void dispose().catch(() => undefined);
      throw error;
    }
  }
  return { replace, dispose };
}

export function updateSquarePaymentRequest(
  request: Pick<SquarePaymentRequest, "update">,
  options: Record<string, unknown>,
): void {
  if (!request.update(options)) {
    throw new Error("Payment details are updating. Please try again.");
  }
}

export function assertPaymentQuoteCurrent(
  expected: string,
  current: string | undefined,
  ready: boolean,
): void {
  if (!ready || current !== expected) {
    throw new Error("Your checkout changed. Review the updated total and try again.");
  }
}
