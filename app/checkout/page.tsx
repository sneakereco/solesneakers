import { CheckoutClient } from "@/components/checkout/CheckoutClient";
import { CheckoutLockedNotice } from "@/components/checkout/CheckoutLockedNotice";
import { CheckoutUnavailable } from "@/components/checkout/CheckoutUnavailable";
import { loadCheckoutPageAccess } from "@/lib/checkout/checkout-page-access";
import { loadCheckoutPageData } from "@/lib/checkout/checkout-page-data";
import { logError } from "@/lib/utils/log";

export default async function CheckoutPage() {
  const access = await loadCheckoutPageAccess();
  if (access.open) {
    try {
      return <CheckoutClient initialData={await loadCheckoutPageData()} />;
    } catch (error) {
      logError(error, { layer: "frontend", route: "/checkout" });
      return <CheckoutUnavailable />;
    }
  }
  return <CheckoutLockedNotice message={access.message} />;
}
