import { FeedbackLink as Link, DocumentFeedbackLink } from "@/components/ui/FeedbackLink";

export function CheckoutUnavailable() {
  return (
    <section className="mx-auto max-w-xl px-6 py-24 text-center">
      <p className="mb-3 text-xs uppercase tracking-[0.2em] text-zinc-500">Checkout</p>
      <h1 className="mb-4 text-3xl font-medium text-black">
        Checkout is temporarily unavailable
      </h1>
      <p className="mx-auto mb-8 max-w-md text-sm leading-6 text-zinc-600">
        We couldn’t load checkout. Try again or return to your cart.
      </p>
      <DocumentFeedbackLink
        href="/checkout"
        className="mr-3 inline-flex min-h-11 items-center justify-center border border-zinc-700 px-5 py-3 text-sm font-medium"
      >
        Retry checkout
      </DocumentFeedbackLink>
      <Link
        href="/cart"
        className="inline-flex min-w-48 justify-center bg-black px-6 py-3 text-sm uppercase tracking-wide text-white"
      >
        Return to cart
      </Link>
    </section>
  );
}
