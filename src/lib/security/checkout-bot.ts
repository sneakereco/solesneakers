import { checkBotId } from "botid/server";

export type CheckoutBotVerdict = {
  allowed: boolean;
  reason: "passed" | "bot" | "unavailable";
};

export async function verifyCheckoutBrowser(): Promise<CheckoutBotVerdict> {
  try {
    const result = await checkBotId({
      advancedOptions: { checkLevel: "basic" },
    });

    return result.isBot
      ? { allowed: false, reason: "bot" }
      : { allowed: true, reason: "passed" };
  } catch {
    return { allowed: false, reason: "unavailable" };
  }
}
