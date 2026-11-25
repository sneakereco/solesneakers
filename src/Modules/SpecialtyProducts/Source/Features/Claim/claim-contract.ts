import { z } from "zod";

export const NORMALIZATION_VERSION = 1 as const;
export const ELIGIBILITY_TTL_MS = 600_000;
export const eligibilityAddressSchema = z
  .object({
    line1: z.string().trim().min(1).max(100),
    line2: z
      .string()
      .trim()
      .max(50)
      .nullable()
      .optional()
      .transform((value) => value || null),
    city: z.string().trim().min(1).max(64),
    state: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/),
    postalCode: z
      .string()
      .trim()
      .regex(/^\d{5}(?:[- ]?\d{4})?$/),
    country: z.literal("US"),
  })
  .strict();
export type EligibilityAddress = z.infer<typeof eligibilityAddressSchema>;
export const attemptCredentialsSchema = z
  .object({
    attemptId: z.string().uuid(),
    recoverySecret: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type AttemptCredentials = z.infer<typeof attemptCredentialsSchema>;
export const eligibilityRequestSchema = z
  .object({
    productId: z.string().uuid(),
    instagramHandle: z.string().trim().min(1).max(100),
    address: eligibilityAddressSchema,
    correctionToken: z.string().max(4096).optional(),
  })
  .strict();
export type EligibilityRequest = z.infer<typeof eligibilityRequestSchema>;
export const claimSubmissionSchema = eligibilityRequestSchema
  .omit({ correctionToken: true })
  .extend({
    ...attemptCredentialsSchema.shape,
    validationToken: z.string().max(4096).optional(),
  })
  .strict();
export type ClaimSubmission = z.infer<typeof claimSubmissionSchema>;
export const claimReceiptSchema = z
  .object({
    claimId: z.string().uuid(),
    productId: z.string().uuid(),
    productName: z.string(),
    instagramHandle: z.string(),
    instructions: z.string(),
    acceptedAt: z.string(),
    decisionOrdinal: z.number().int().positive(),
  })
  .strict();
export type ClaimReceipt = z.infer<typeof claimReceiptSchema>;
export const claimDecisionSchema = z.union([
  z.object({ status: z.literal("won"), receipt: claimReceiptSchema }).strict(),
  z.object({ status: z.enum(["sold_out", "already_claimed", "closed"]) }).strict(),
]);
export type ClaimDecision = z.infer<typeof claimDecisionSchema>;
export const claimReplySchema = z
  .object({ result: claimDecisionSchema, replayed: z.boolean() })
  .strict();
export type ClaimReply = z.infer<typeof claimReplySchema>;
export const validatedEligibilitySchema = z
  .object({
    campaignId: z.string().uuid(),
    productId: z.string().uuid(),
    browserId: z.string().min(16).max(128),
    instagramHandle: z.string(),
    address: eligibilityAddressSchema,
    addressKey: z.string().regex(/^[a-f0-9]{64}$/),
    instagramKey: z.string().regex(/^[a-f0-9]{64}$/),
    identityKeyFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    normalizationVersion: z.literal(1),
    expiresAt: z.number().int().positive(),
  })
  .strict();
export type ValidatedEligibility = z.infer<typeof validatedEligibilitySchema>;
export type SpecialtyPublicProduct = {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  claimable: boolean;
};
export type SpecialtyContext = {
  campaignId: string;
  productId: string;
  browserId: string;
  normalizationVersion: 1;
  identityKeyFingerprint: string | null;
};
export type ProtectionDecision =
  | { allowed: true }
  | { allowed: false; status: 403 | 429 | 503; retryAfterSeconds?: number };
export type AwardCommand = {
  attemptId: string;
  recoveryHash: string;
  inputHash: string;
  payloadHash: string;
  eligibility: ValidatedEligibility;
};
export type StoredAttempt = {
  inputHash: string;
  payloadHash: string;
  result: ClaimDecision;
};
export type ValidationReply =
  | {
      status: "valid";
      address: EligibilityAddress;
      validationToken: string;
      expiresAt: number;
    }
  | {
      status: "correction_required";
      address: EligibilityAddress;
      correctionToken: string;
    }
  | { status: "invalid"; fields: Record<string, string> }
  | { status: "unavailable"; retryAfterSeconds: number };
