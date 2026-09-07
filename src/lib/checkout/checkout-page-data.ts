import { env } from "@/config/env";
import { getServerSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSquareConfig } from "@/lib/square/config";
import type { SquareEnvironment } from "@/lib/square/web-payments";
import { ShippingService } from "@/services/shipping-service";
import type { Tables } from "@/types/db/database.types";

type ShippingProfile = Pick<
  Tables<"shipping_profiles">,
  | "full_name"
  | "phone"
  | "address_line1"
  | "address_line2"
  | "city"
  | "state"
  | "postal_code"
  | "country"
>;

type CheckoutPageSession = {
  user: { id: string; email: string };
  profile: { full_name: string | null } | null;
} | null;

export type CheckoutAddressForm = {
  name: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: "US";
};

export type CheckoutPageData = {
  isGuest: boolean;
  customer: { email: string; address: CheckoutAddressForm };
  paymentConfig: {
    applicationId: string;
    locationId: string;
    environment: SquareEnvironment;
  };
};

export type CheckoutPageDataDependencies = {
  getSession(): Promise<CheckoutPageSession>;
  getShippingProfile(userId: string): Promise<ShippingProfile | null>;
  getPaymentConfig(): CheckoutPageData["paymentConfig"];
};

const EMPTY_ADDRESS: CheckoutAddressForm = {
  name: "",
  phone: "",
  line1: "",
  line2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "US",
};

const defaultDependencies: CheckoutPageDataDependencies = {
  getSession: getServerSession,
  getShippingProfile: async (userId) => {
    const supabase = await createSupabaseServerClient();
    return new ShippingService(supabase).getProfile(userId);
  },
  getPaymentConfig: () => {
    const square = getSquareConfig();
    if (!env.SQUARE_APPLICATION_ID) {
      throw new Error("square_configuration_invalid");
    }
    return {
      applicationId: env.SQUARE_APPLICATION_ID,
      locationId: square.locationId,
      environment: square.environment,
    };
  },
};

export async function loadCheckoutPageData(
  deps: CheckoutPageDataDependencies = defaultDependencies,
): Promise<CheckoutPageData> {
  const session = await deps.getSession();
  const profile = session ? await deps.getShippingProfile(session.user.id) : null;

  return {
    isGuest: !session,
    customer: {
      email: session?.user.email ?? "",
      address: profile
        ? {
            name: profile.full_name ?? session?.profile?.full_name ?? "",
            phone: profile.phone ?? "",
            line1: profile.address_line1 ?? "",
            line2: profile.address_line2 ?? "",
            city: profile.city ?? "",
            state: profile.state?.toUpperCase() ?? "",
            postalCode: profile.postal_code ?? "",
            country: "US",
          }
        : { ...EMPTY_ADDRESS, name: session?.profile?.full_name ?? "" },
    },
    paymentConfig: deps.getPaymentConfig(),
  };
}
