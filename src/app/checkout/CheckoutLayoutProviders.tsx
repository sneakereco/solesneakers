"use client";
import { usePathname } from "next/navigation";
import { CheckoutPaymentProvider } from "@/components/checkout/CheckoutPaymentDialog";
import { CheckoutOutcomeProvider } from "@/Modules/Checkout/Source/Client";
import { useSession } from "@/contexts/SessionContext";

export function CheckoutLayoutProviders({ children }: { children: React.ReactNode }) {
  const session = useSession();
  const path = usePathname();
  return (
    <CheckoutPaymentProvider>
      <CheckoutOutcomeProvider
        observation={session.isCurrent}
        ownerId={session.user?.id ?? null}
        account={Boolean(session.user)}
        path={path}
      >
        {children}
      </CheckoutOutcomeProvider>
    </CheckoutPaymentProvider>
  );
}
