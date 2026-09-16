import { CheckoutPaymentProvider } from "@/components/checkout/CheckoutPaymentDialog";

export default function CheckoutLayout({ children }: { children: React.ReactNode }) {
  return <CheckoutPaymentProvider>{children}</CheckoutPaymentProvider>;
}
