import { createSupabaseAdminClient } from "@/lib/supabase/service-role";
export async function readCheckoutControls() {
  const { data, error } = await createSupabaseAdminClient()
    .from("checkout_operational_controls")
    .select("pause_new_checkouts,pause_payment_dispatch")
    .eq("singleton", true)
    .single();
  if (
    error ||
    typeof data?.pause_new_checkouts !== "boolean" ||
    typeof data.pause_payment_dispatch !== "boolean"
  )
    throw Error("checkout_controls_unavailable");
  return {
    pauseNewCheckouts: data.pause_new_checkouts,
    pausePaymentDispatch: data.pause_payment_dispatch,
  };
}
