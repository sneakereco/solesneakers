import type { SquarePaymentRequest } from "@/lib/square/web-payments";

// Square destroys DOM it owns. Serialize cleanup with attachment so an old
// instance cannot empty the container belonging to its replacement.
export function createSquareMethodLifecycle<
  T extends { destroy?(): Promise<boolean> },
>() {
  let generation = 0;
  let current: T | null = null;
  let pending = Promise.resolve();

  async function destroy() {
    if (current) {
      await current.destroy?.();
      current = null;
    }
  }

  function replace(create: () => Promise<T>, attach: (method: T) => Promise<void>) {
    const next = ++generation;
    const operation = pending.then(async () => {
      await destroy();
      if (generation !== next) {
        return;
      }
      current = await create();
      try {
        if (generation === next) {
          await attach(current);
        }
      } catch (error) {
        await destroy();
        throw error;
      }
      if (generation !== next) {
        await destroy();
      }
    });
    pending = operation.catch(() => undefined);
    return operation;
  }

  function dispose() {
    ++generation;
    const operation = pending.then(destroy);
    pending = operation.catch(() => undefined);
    return operation;
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
