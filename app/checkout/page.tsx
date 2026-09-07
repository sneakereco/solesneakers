import { CheckoutClient } from "@/components/checkout/CheckoutClient";
import { CheckoutLockedNotice } from "@/components/checkout/CheckoutLockedNotice";
import { loadCheckoutPageAccess } from "@/lib/checkout/checkout-page-access";

export default async function CheckoutPage() {
  const access = await loadCheckoutPageAccess();
  if (access.open) {
    return <CheckoutClient />;
  }
  return <CheckoutLockedNotice message={access.message} />;
}
