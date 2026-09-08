import Link from "next/link";

import { CHECKOUT_INPUT_CLASS } from "@/components/checkout/checkout-field-styles";

export function CheckoutContactSection({
  email,
  isGuest,
  onEmailChange,
}: {
  email: string;
  isGuest: boolean;
  onEmailChange(value: string): void;
}) {
  return (
    <section className="order-2" aria-labelledby="contact-heading">
      <div className="flex items-center justify-between gap-4">
        <h2 id="contact-heading" className="text-2xl font-semibold">
          Contact
        </h2>
        {isGuest ? (
          <Link
            href="/auth/login?next=%2Fcheckout"
            className="text-sm text-sky-700 underline-offset-2 hover:underline"
          >
            Sign in
          </Link>
        ) : null}
      </div>
      <label className="mt-4 block">
        <span className="sr-only">Email</span>
        <input
          type="email"
          required
          aria-label="Email"
          placeholder="Email"
          autoComplete="email"
          value={email}
          disabled={!isGuest}
          onChange={(event) => onEmailChange(event.target.value)}
          className={CHECKOUT_INPUT_CLASS}
        />
      </label>
    </section>
  );
}
