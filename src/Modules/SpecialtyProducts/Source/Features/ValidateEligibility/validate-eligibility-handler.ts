import {
  ELIGIBILITY_TTL_MS,
  eligibilityRequestSchema,
  type EligibilityAddress,
  type ProtectionDecision,
  type SpecialtyContext,
  type ValidatedEligibility,
  type ValidationReply,
} from "../Claim/claim-contract";
import {
  canonicalAddressIdentity,
  deriveEligibilityKeys,
  getIdentityKeyFingerprint,
  normalizeInstagramHandle,
} from "../Claim/normalize-identity";
import {
  issueCorrectionToken,
  issueEligibilityToken,
  verifyCorrectionToken,
} from "../Claim/validation-token";
import type { validateEligibilityAddress } from "./address-provider";

export type EligibilityDependencies = {
  getContext(request: Request, productId: string): Promise<SpecialtyContext | null>;
  protect(
    request: Request,
    operation: "validate" | "submit" | "recover",
    browserId: string,
  ): Promise<ProtectionDecision>;
  validateAddress(
    address: EligibilityAddress,
  ): ReturnType<typeof validateEligibilityAddress>;
  secret(): string | null;
  nowMs(): number;
};
function reply(body: ValidationReply, status = 200, retryAfter?: number): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}),
    },
  });
}
function invalid(field: string): Response {
  return reply(
    {
      status: "invalid",
      fields: {
        [field]:
          field === "instagramHandle"
            ? "Enter a valid Instagram handle."
            : "Enter and confirm a valid US address.",
      },
    },
    422,
  );
}
function unavailable(status = 503, retryAfter = 1): Response {
  return reply(
    { status: "unavailable", retryAfterSeconds: retryAfter },
    status,
    retryAfter,
  );
}
export async function validateEligibilityHandler(
  request: Request,
  deps: EligibilityDependencies,
): Promise<Response> {
  try {
    const parsed = eligibilityRequestSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) return invalid("address");
    const input = parsed.data;
    let handle: string;
    try {
      handle = normalizeInstagramHandle(input.instagramHandle);
    } catch {
      return invalid("instagramHandle");
    }
    const context = await deps.getContext(request, input.productId);
    const secret = deps.secret();
    if (
      !context ||
      !secret ||
      context.identityKeyFingerprint !== getIdentityKeyFingerprint(secret)
    )
      return unavailable();
    const protection = await deps.protect(request, "validate", context.browserId);
    if (!protection.allowed)
      return unavailable(protection.status, protection.retryAfterSeconds ?? 1);
    const binding = {
      campaignId: context.campaignId,
      productId: context.productId,
      browserId: context.browserId,
    };
    if (input.correctionToken) {
      const confirmed = verifyCorrectionToken(
        input.correctionToken,
        binding,
        secret,
        deps.nowMs(),
      );
      if (
        !confirmed ||
        confirmed.instagramHandle !== handle ||
        canonicalAddressIdentity(input.address) !==
          canonicalAddressIdentity(confirmed.address)
      )
        return invalid("address");
      return reply({
        status: "valid",
        address: confirmed.address,
        expiresAt: confirmed.expiresAt,
        validationToken: issueEligibilityToken(confirmed, secret),
      });
    }
    const result = await deps.validateAddress(input.address);
    if (result.status === "unavailable") return unavailable();
    if (result.status === "invalid") return invalid("address");
    const proof: ValidatedEligibility = {
      ...binding,
      instagramHandle: handle,
      address: result.address,
      ...deriveEligibilityKeys(context.campaignId, handle, result.address, secret),
      normalizationVersion: 1,
      identityKeyFingerprint: context.identityKeyFingerprint,
      expiresAt: deps.nowMs() + ELIGIBILITY_TTL_MS,
    };
    if (result.status === "correction_required")
      return reply({
        status: "correction_required",
        address: result.address,
        correctionToken: issueCorrectionToken(proof, secret),
      });
    return reply({
      status: "valid",
      address: result.address,
      expiresAt: proof.expiresAt,
      validationToken: issueEligibilityToken(proof, secret),
    });
  } catch {
    return unavailable();
  }
}
