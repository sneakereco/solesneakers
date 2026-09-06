import { z } from "zod";

export type TurnstileVerdict = {
  allowed: boolean;
  reason: "passed" | "invalid" | "unavailable";
};

export type TurnstileVerificationInput = {
  token: string;
  remoteIp: string;
};

export type TurnstileDependencies = {
  secretKey: string;
  expectedHostname: string;
  expectedAction: string;
  fetch: typeof fetch;
};

const responseSchema = z.object({
  success: z.boolean(),
  hostname: z.string().optional(),
  action: z.string().optional(),
});

export async function verifyTurnstile(
  input: TurnstileVerificationInput,
  deps: TurnstileDependencies,
): Promise<TurnstileVerdict> {
  if (!input.token || input.token.length > 2048 || !input.remoteIp) {
    return { allowed: false, reason: "invalid" };
  }

  try {
    const body = new URLSearchParams({
      secret: deps.secretKey,
      response: input.token,
      remoteip: input.remoteIp,
    });
    const response = await deps.fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!response.ok) {
      return { allowed: false, reason: "unavailable" };
    }

    const result = responseSchema.safeParse(await response.json());
    if (!result.success) {
      return { allowed: false, reason: "unavailable" };
    }
    if (
      !result.data.success ||
      result.data.hostname !== deps.expectedHostname ||
      result.data.action !== deps.expectedAction
    ) {
      return { allowed: false, reason: "invalid" };
    }

    return { allowed: true, reason: "passed" };
  } catch {
    return { allowed: false, reason: "unavailable" };
  }
}
