import { z } from "zod";
import { revalidateTag } from "next/cache";
import { env } from "@/config/env";
import { requireAdminApi } from "@/lib/auth/session";
import {
  createSupabaseAdminClient,
  type AdminSupabaseClient,
} from "@/lib/supabase/service-role";
import {
  eligibilityAddressSchema,
  type ClaimReceipt,
  type EligibilityAddress,
} from "../Claim/claim-contract";
import { getIdentityKeyFingerprint } from "../Claim/normalize-identity";
export type AdminClaimStatus = "new" | "contacted" | "fulfilled";
export type AdminSpecialtyClaim = ClaimReceipt & {
  imageUrl: string | null;
  address: EligibilityAddress;
  status: AdminClaimStatus;
  revision: number;
  updatedBy: string | null;
  updatedAt: string;
};
export type SpecialtyCampaignState = {
  enabled: boolean;
  revision: number;
  keyReady: boolean;
};
export const adminClaimsQuerySchema = z
  .object({
    productId: z.string().uuid().optional(),
    status: z.enum(["new", "contacted", "fulfilled"]).optional(),
    page: z.coerce.number().int().min(1).max(1000000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export const adminClaimStatusSchema = z
  .object({
    status: z.enum(["new", "contacted", "fulfilled"]),
    expectedRevision: z.number().int().positive(),
  })
  .strict();
export const adminCampaignWriteSchema = z
  .object({ enabled: z.boolean(), expectedRevision: z.number().int().positive() })
  .strict();
export class AdminSpecialtyError extends Error {
  constructor(
    readonly code: "conflict" | "invalid" | "not_found" | "forbidden" | "unavailable",
  ) {
    super(
      code === "conflict"
        ? "This record changed. Refresh and try again."
        : code === "forbidden"
          ? "Forbidden"
          : code === "not_found"
            ? "Claim not found."
            : code === "invalid"
              ? "Check the claim details."
              : "Specialty claims are temporarily unavailable.",
    );
  }
}
const rowSchema = z.object({
  id: z.string().uuid(),
  product_id: z.string().uuid(),
  product_name: z.string(),
  product_image_url: z.string().nullable(),
  instagram_handle: z.string(),
  eligibility_address: eligibilityAddressSchema,
  instructions: z.string(),
  accepted_at: z.string(),
  decision_ordinal: z.number().int().positive(),
  follow_up_status: z.enum(["new", "contacted", "fulfilled"]),
  revision: z.number().int().positive(),
  updated_by: z.string().uuid().nullable(),
  updated_at: z.string(),
});
const columns =
  "id,product_id,product_name,product_image_url,instagram_handle,eligibility_address,instructions,accepted_at,decision_ordinal,follow_up_status,revision,updated_by,updated_at";
function mapClaim(value: unknown): AdminSpecialtyClaim {
  const row = rowSchema.parse(value);
  return {
    claimId: row.id,
    productId: row.product_id,
    productName: row.product_name,
    imageUrl: row.product_image_url,
    instagramHandle: row.instagram_handle,
    address: row.eligibility_address,
    instructions: row.instructions,
    acceptedAt: row.accepted_at,
    decisionOrdinal: row.decision_ordinal,
    status: row.follow_up_status,
    revision: row.revision,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}
async function authorizedClient(actorId?: string): Promise<AdminSupabaseClient> {
  const session = await requireAdminApi();
  if (actorId !== undefined && actorId !== session.user.id)
    throw new AdminSpecialtyError("forbidden");
  return createSupabaseAdminClient();
}
async function readCampaign(client: AdminSupabaseClient) {
  const { data, error } = await client
    .from("specialty_campaigns")
    .select("id,enabled,revision,identity_key_fingerprint")
    .eq("slug", env.SPECIALTY_CAMPAIGN_SLUG)
    .single();
  if (error || !data) throw new AdminSpecialtyError("unavailable");
  return data;
}
function databaseFailure(error: { message: string }): never {
  throw new AdminSpecialtyError(
    error.message.includes("specialty_revision_conflict")
      ? "conflict"
      : error.message.includes("specialty_claim_missing")
        ? "not_found"
        : "unavailable",
  );
}
export async function listSpecialtyClaims(input: {
  productId?: string;
  status?: AdminClaimStatus;
  page: number;
  pageSize: number;
}): Promise<{ claims: AdminSpecialtyClaim[]; total: number }> {
  const client = await authorizedClient();
  const filters = adminClaimsQuerySchema.parse(input);
  const campaign = await readCampaign(client);
  let query = client
    .from("specialty_claims")
    .select(columns, { count: "exact" })
    .eq("campaign_id", campaign.id)
    .order("accepted_at", { ascending: false })
    .order("id", { ascending: false });
  if (filters.productId) query = query.eq("product_id", filters.productId);
  if (filters.status) query = query.eq("follow_up_status", filters.status);
  const offset = (filters.page - 1) * filters.pageSize;
  const { data, error, count } = await query.range(offset, offset + filters.pageSize - 1);
  if (error) throw new AdminSpecialtyError("unavailable");
  return { claims: (data ?? []).map(mapClaim), total: count ?? 0 };
}
export async function updateSpecialtyClaimStatus(
  input: { claimId: string; status: AdminClaimStatus; expectedRevision: number },
  actorId: string,
): Promise<AdminSpecialtyClaim> {
  const client = await authorizedClient(actorId);
  const parsed = adminClaimStatusSchema
    .extend({ claimId: z.string().uuid() })
    .parse(input);
  const { data, error } = await client.rpc("update_specialty_claim_status", {
    p_claim_id: parsed.claimId,
    p_status: parsed.status,
    p_expected_revision: parsed.expectedRevision,
    p_actor_id: actorId,
  });
  if (error) databaseFailure(error);
  return mapClaim(data);
}
export async function getSpecialtyCampaignState(): Promise<SpecialtyCampaignState> {
  const campaign = await readCampaign(await authorizedClient());
  const secret = env.SPECIALTY_CLAIMS_SECRET;
  return {
    enabled: campaign.enabled,
    revision: campaign.revision,
    keyReady: Boolean(
      secret &&
        (!campaign.identity_key_fingerprint ||
          campaign.identity_key_fingerprint === getIdentityKeyFingerprint(secret)),
    ),
  };
}
export async function setSpecialtyCampaignEnabled(
  input: { enabled: boolean; expectedRevision: number },
  actorId: string,
): Promise<{ enabled: boolean; revision: number }> {
  const client = await authorizedClient(actorId);
  const parsed = adminCampaignWriteSchema.parse(input);
  const campaign = await readCampaign(client),
    secret = env.SPECIALTY_CLAIMS_SECRET;
  if (parsed.enabled && !secret) throw new AdminSpecialtyError("unavailable");
  const { data, error } = await client.rpc("set_specialty_campaign_enabled", {
    p_campaign_id: campaign.id,
    p_enabled: parsed.enabled,
    p_expected_revision: parsed.expectedRevision,
    p_actor_id: actorId,
    p_identity_key_fingerprint: secret ? getIdentityKeyFingerprint(secret) : "",
  });
  if (error) databaseFailure(error);
  const result = z
    .object({ enabled: z.boolean(), revision: z.number().int().positive() })
    .parse(data);
  try {
    revalidateTag("specialty:discovery", { expire: 0 });
  } catch {
    /* Campaign committed. CDN pool expires in five seconds. */
  }
  return result;
}
export async function listSpecialtyClaimProducts(): Promise<
  Array<{ id: string; name: string }>
> {
  const client = await authorizedClient();
  const campaign = await readCampaign(client);
  const { data, error } = await client
    .from("specialty_product_config")
    .select("product:products!inner(id,name)")
    .eq("campaign_id", campaign.id)
    .order("product_id")
    .limit(1000);
  if (error) throw new AdminSpecialtyError("unavailable");
  return z
    .array(z.object({ product: z.object({ id: z.string().uuid(), name: z.string() }) }))
    .parse(data ?? [])
    .map((item) => item.product);
}
