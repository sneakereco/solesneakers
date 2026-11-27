import {
  createSquareMethodLifecycle,
  updateSquarePaymentRequest,
  assertPaymentQuoteCurrent,
} from "@/components/checkout/square-method-lifecycle";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("Square method lifecycle", () => {
  it("disposes a late provider result without attaching it to the current checkout", async () => {
    const events: string[] = [];
    const provider = deferred<{ destroy(): Promise<boolean> }>();
    const lifecycle = createSquareMethodLifecycle<{ destroy(): Promise<boolean> }>();
    const started = deferred<void>();
    const first = lifecycle.replace(
      () => {
        started.resolve();
        return provider.promise;
      },
      () => {
        events.push("attach");
        return Promise.resolve();
      },
    );
    await started.promise;
    const cleanup = lifecycle.dispose();
    provider.resolve({
      destroy: () => {
        events.push("destroy");
        return Promise.resolve(true);
      },
    });
    await Promise.all([first, cleanup]);
    expect(events).toEqual(["destroy"]);
  });

  it("allows a new host to attach before retired provider work finishes", async () => {
    const events: string[] = [];
    const attachment = deferred<void>();
    const destruction = deferred<boolean>();
    const started = deferred<void>();
    const lifecycle = createSquareMethodLifecycle<{ destroy(): Promise<boolean> }>();
    const first = lifecycle.replace(
      () =>
        Promise.resolve({
          destroy: () => {
            events.push("destroy old");
            return destruction.promise;
          },
        }),
      async () => {
        events.push("attach old");
        started.resolve();
        await attachment.promise;
      },
    );
    await started.promise;
    const second = lifecycle.replace(
      () => Promise.resolve({ destroy: () => Promise.resolve(true) }),
      () => {
        events.push("attach new");
        return Promise.resolve();
      },
    );
    await second;
    expect(events).toEqual(["attach old", "destroy old", "attach new"]);
    attachment.resolve();
    destruction.resolve(true);
    await Promise.all([first, second]);
    expect(events).toEqual(["attach old", "destroy old", "attach new", "destroy old"]);
    await lifecycle.dispose();
  });

  it("fails closed when Square cannot update the amount before opening a wallet", () => {
    expect(() =>
      updateSquarePaymentRequest(
        { update: () => false },
        { total: { amount: "118.00" } },
      ),
    ).toThrow("Payment details are updating");
    expect(() =>
      updateSquarePaymentRequest({ update: () => true }, { total: { amount: "118.00" } }),
    ).not.toThrow();
  });

  it("rejects wallet authorization after address, fulfillment, or quote readiness changes", () => {
    expect(() => assertPaymentQuoteCurrent("shipping-a", "pickup-b", true)).toThrow();
    expect(() => assertPaymentQuoteCurrent("shipping-a", "shipping-a", false)).toThrow();
    expect(() =>
      assertPaymentQuoteCurrent("shipping-a", "shipping-a", true),
    ).not.toThrow();
  });
});
