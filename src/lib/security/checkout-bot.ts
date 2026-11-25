import { checkBotId } from "botid/server";
import { getActiveLoadTestContext } from "@/Modules/Checkout/Source/Features/LoadTesting/context";

export type CheckoutBotVerdict = {
  allowed: boolean;
  reason: "passed" | "bot" | "unavailable";
};

export async function verifyCheckoutBrowser(): Promise<CheckoutBotVerdict> {
  if (getActiveLoadTestContext()?.providerMode === "simulated")
    return { allowed: true, reason: "passed" };
  try {
    const result = await checkBotId({
      advancedOptions: { checkLevel: "deepAnalysis" },
    });

    return result.isBot
      ? { allowed: false, reason: "bot" }
      : { allowed: true, reason: "passed" };
  } catch {
    return { allowed: false, reason: "unavailable" };
  }
}
