import { redirect } from "next/navigation";

import { CheckoutLockedNotice } from "@/components/checkout/CheckoutLockedNotice";
import { loadCheckoutPageAccess } from "@/lib/checkout/checkout-page-access";

export default async function CheckoutPage() {
  const access = await loadCheckoutPageAccess();
  if (access.open) {
    redirect("/cart");
    return null;
  }
  return <CheckoutLockedNotice message={access.message} />;
}
