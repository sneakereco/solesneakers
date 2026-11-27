import { randomUUID } from "node:crypto";
import type { AdminSupabaseClient } from "@/lib/supabase/service-role";
import { z } from "zod";
const checkoutBudgetsSchema = z
  .object({
    version: z.literal(1),
    revision: z.string().trim().min(1).max(64),
    ipPerMinute: z.number().int().positive().max(2147483647),
    globalPerMinute: z.number().int().positive().max(2147483647),
    providers: z
      .object({
        square: z.number().int().min(1).max(4),
        shippo: z.number().int().min(1).max(4),
      })
      .strict(),
  })
  .strict();
export type CheckoutAdmissionBudgets = z.infer<typeof checkoutBudgetsSchema>;
export function parseCheckoutAdmissionBudgets(
  raw?: string,
): CheckoutAdmissionBudgets | null {
  try {
    return checkoutBudgetsSchema.parse(JSON.parse(raw ?? ""));
  } catch {
    return null;
  }
}
export const checkoutAdmissionBudgets = parseCheckoutAdmissionBudgets(
  process.env.CHECKOUT_ADMISSION_BUDGETS,
);

export type AdmissionDecision = { allowed: boolean; retryAfterSeconds: number | null };
export type AdmissionInput = {
  kind: "new_prepare" | "resume" | "gateway_attempt" | "decline";
  shopperBinding: string;
  orderId?: string;
  eventId?: string;
  ip: string;
};

export type Window = { key: string; limit: number; windowMs: number; member: string };
type Dependencies = {
  budgets: CheckoutAdmissionBudgets | null;
  consume(windows: Window[]): Promise<AdmissionDecision>;
  financial?(input: AdmissionInput): Promise<AdmissionDecision>;
};
export const allowed: AdmissionDecision = { allowed: true, retryAfterSeconds: null };

export function coarseWindows(ip: string, budgets: CheckoutAdmissionBudgets): Window[] {
  const request = randomUUID();
  return [
    { key: "ip:" + ip, limit: budgets.ipPerMinute, windowMs: 60000, member: request },
    { key: "global", limit: budgets.globalPerMinute, windowMs: 60000, member: request },
  ];
}

export function preparationWindow(shopperBinding: string, eventId?: string): Window {
  if (!eventId) throw Error("checkout_preparation_key_missing");
  return {
    key: "prepare:" + shopperBinding,
    limit: 5,
    windowMs: 600000,
    member: eventId,
  };
}

export async function admitCheckout(
  input: AdmissionInput,
  deps: Dependencies,
): Promise<AdmissionDecision> {
  if (!input.shopperBinding) throw Error("checkout_admission_binding_missing");
  if (input.kind === "decline") {
    if (!input.orderId || !deps.financial)
      throw Error("checkout_financial_admission_missing");
    return deps.financial(input);
  }
  if (!input.ip) throw Error("checkout_protection_unavailable");
  // Only an authorized, already attached original order uses this read path.
  // The perimeter's normal read protection remains available during admission outages.
  if (input.kind === "resume")
    return deps.budgets
      ? deps.consume(coarseWindows(input.ip, deps.budgets)).catch(() => allowed)
      : allowed;
  if (!deps.budgets) throw Error("checkout_protection_unavailable");
  const windows = coarseWindows(input.ip, deps.budgets);
  if (input.kind === "new_prepare")
    windows.push(preparationWindow(input.shopperBinding, input.eventId));
  const coarse = await deps.consume(windows);
  if (!coarse.allowed || input.kind !== "gateway_attempt") return coarse;
  if (!input.orderId || !deps.financial)
    throw Error("checkout_financial_admission_missing");
  return deps.financial(input);
}

// Redis time governs the entire operation across app instances. A duplicate key
// keeps its original score. Coarse request windows charge each incoming request.
export const slidingWindowsScript = `
local clock = redis.call("TIME")
local now = tonumber(clock[1])*1000 + math.floor(tonumber(clock[2])/1000)
local retry = 0
for i,key in ipairs(KEYS) do
  local j=(i-1)*3
  local interval=tonumber(ARGV[j+1])
  redis.call("ZREMRANGEBYSCORE",key,"-inf",now-interval)
  if not redis.call("ZSCORE",key,ARGV[j+3]) and redis.call("ZCARD",key)>=tonumber(ARGV[j+2]) then
    local first=redis.call("ZRANGE",key,0,0,"WITHSCORES")
    retry=math.max(retry,tonumber(first[2])+interval-now)
  end
end
if retry>0 then return {0,retry} end
for i,key in ipairs(KEYS) do
  local j=(i-1)*3
  redis.call("ZADD",key,"NX",now,ARGV[j+3])
  redis.call("PEXPIRE",key,tonumber(ARGV[j+1]))
end
return {1,0}
`;

export async function financialAdmission(
  client: Pick<AdminSupabaseClient, "rpc">,
  input: AdmissionInput,
) {
  if (!input.orderId) throw Error("checkout_admission_order_missing");
  const { data, error } = await client.rpc("checkout_financial_admission", {
    p_order_id: input.orderId,
    p_shopper_binding: input.shopperBinding,
    p_kind: input.kind,
  });
  if (error || typeof data !== "number" || !Number.isSafeInteger(data) || data < 0)
    throw Error("checkout_financial_admission_unavailable");
  return data === 0 ? allowed : { allowed: false, retryAfterSeconds: data };
}
