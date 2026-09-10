import Link from "next/link";

import { CHECKOUT_INPUT_CLASS } from "@/components/checkout/checkout-field-styles";
import { CheckoutHelpTooltip } from "@/components/checkout/CheckoutHelpTooltip";

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
        <h2 id="contact-heading" className="text-xl font-semibold">
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
      <div className="relative mt-3">
        <input
          type="email"
          required
          aria-label="Email"
          placeholder="Email"
          autoComplete="email"
          value={email}
          disabled={!isGuest}
          onChange={(event) => onEmailChange(event.target.value)}
          className={`${CHECKOUT_INPUT_CLASS} pr-10`}
        />
        <CheckoutHelpTooltip label="Email help">
          Used for your order confirmation and cart reminders
        </CheckoutHelpTooltip>
      </div>
    </section>
  );
}
