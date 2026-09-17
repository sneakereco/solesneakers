import Link from "next/link";

export function CheckoutLegalNotice({ express = false }: { express?: boolean }) {
  return (
    <p className="mt-3 text-center text-xs leading-5 text-zinc-500">
      {express ? "By using an express payment method" : "By placing your order"}, you
      agree to our{" "}
      <Link href="/terms" className="underline underline-offset-2">
        Terms of Service
      </Link>{" "}
      and acknowledge our{" "}
      <Link href="/privacy" className="underline underline-offset-2">
        Privacy Policy
      </Link>
      .
    </p>
  );
}
