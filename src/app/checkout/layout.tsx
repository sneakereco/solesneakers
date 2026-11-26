import { pageMetadata } from "@/lib/metadata";

export const metadata = {
  ...pageMetadata(
    "Checkout",
    "Review your order, choose shipping or local pickup, and complete your Solesneakers purchase.",
  ),
  robots: { index: false, follow: false },
};

import { CheckoutLayoutProviders } from "./CheckoutLayoutProviders";

export default function CheckoutLayout({ children }: { children: React.ReactNode }) {
  return <CheckoutLayoutProviders>{children}</CheckoutLayoutProviders>;
}
