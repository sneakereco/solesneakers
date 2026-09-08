export function ExpressCheckoutMethods({
  applePayReady,
  googlePayReady,
  cashAppPayReady,
  quoteIsExact,
  onApplePayClick,
  onGooglePayClick,
}: {
  applePayReady: boolean;
  googlePayReady: boolean;
  cashAppPayReady: boolean;
  quoteIsExact: boolean;
  onApplePayClick(): void;
  onGooglePayClick(): void;
}) {
  const hasReadyMethod = applePayReady || googlePayReady || cashAppPayReady;

  return (
    <section
      className="order-1"
      aria-labelledby="express-checkout-heading"
      hidden={!hasReadyMethod}
    >
      <h2 id="express-checkout-heading" className="text-center text-sm text-zinc-600">
        Express checkout
      </h2>
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <button
          id="square-apple-pay-container"
          type="button"
          hidden={!applePayReady}
          aria-label="Pay with Apple Pay"
          className="h-12 rounded bg-black"
          onClick={onApplePayClick}
        />
        <div
          id="square-google-pay-container"
          hidden={!googlePayReady}
          className="min-h-12"
          onClick={onGooglePayClick}
        />
        <div
          id="square-cash-app-pay-container"
          hidden={!cashAppPayReady}
          className="min-h-12"
        />
      </div>
      {!quoteIsExact ? (
        <p className="mt-3 text-center text-xs text-zinc-500">Calculated after address</p>
      ) : null}
      <div className="my-6 flex items-center gap-4 text-xs uppercase text-zinc-400">
        <span className="h-px flex-1 bg-zinc-200" /> or
        <span className="h-px flex-1 bg-zinc-200" />
      </div>
    </section>
  );
}
