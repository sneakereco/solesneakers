export function ExpressCheckoutMethods({
  applePayReady,
  googlePayReady,
  disabled = false,
  loading,
  onApplePayClick,
  onGooglePayClick,
}: {
  applePayReady: boolean;
  googlePayReady: boolean;
  disabled?: boolean;
  loading: boolean;
  onApplePayClick(): void;
  onGooglePayClick(): void;
}) {
  const hasReadyMethod = applePayReady || googlePayReady;

  return (
    <section
      className="order-1"
      aria-labelledby="express-checkout-heading"
      hidden={!loading && !hasReadyMethod}
    >
      <h2 id="express-checkout-heading" className="text-center text-sm text-zinc-600">
        Express checkout
      </h2>
      {loading && !hasReadyMethod ? (
        <p role="status" className="mt-3 text-center text-sm text-zinc-500">
          Checking available express payment methods…
        </p>
      ) : null}
      <div
        className={`mt-4 grid grid-cols-1 gap-2 ${applePayReady && googlePayReady ? "sm:grid-cols-2" : ""}`}
      >
        <button
          id="square-apple-pay-container"
          type="button"
          hidden={!applePayReady}
          disabled={disabled}
          aria-label="Pay with Apple Pay"
          className="h-12 w-full rounded bg-black [-webkit-appearance:-apple-pay-button] [-apple-pay-button-style:black] [-apple-pay-button-type:plain]"
          onClick={onApplePayClick}
        />
        <div
          id="square-google-pay-container"
          hidden={!googlePayReady}
          className="h-12 w-full"
          inert={disabled}
          aria-disabled={disabled}
          onClick={disabled ? undefined : onGooglePayClick}
        />
      </div>
      <div className="my-6 flex items-center gap-4 text-xs uppercase text-zinc-400">
        <span className="h-px flex-1 bg-zinc-200" /> or
        <span className="h-px flex-1 bg-zinc-200" />
      </div>
    </section>
  );
}
