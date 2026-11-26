import { z } from "zod";
import { revalidateTag } from "next/cache";
import { AuthError, requireAdminApi } from "@/lib/auth/session";
import { ensureTenantId } from "@/lib/auth/tenant";
import { createSupabaseAdminClient } from "@/lib/supabase/service-role";
import {
  privateClaimReply as reply,
  readClaimJson,
  ClaimBodyError,
} from "../Claim/claim-http";
import { specialtyProductWriteSchema } from "./specialty-product-contract";
import {
  SpecialtyProductError,
  SpecialtyProductRepository,
} from "./specialty-product-repository";
import { env } from "@/config/env";
export async function saveSpecialtyProductHandler(
  request: Request,
  productId: string | null,
): Promise<Response> {
  try {
    const session = await requireAdminApi();
    const parsed = specialtyProductWriteSchema.safeParse(await readClaimJson(request));
    if (
      !parsed.success ||
      (productId !== null && !z.string().uuid().safeParse(productId).success)
    )
      return reply({ error: "Check the specialty product details." }, 422);
    const input = parsed.data;
    if (
      productId === null
        ? input.mode !== "create"
        : input.mode !== "update" || input.productId !== productId
    )
      return reply({ error: "Product and editing mode do not match." }, 422);
    const client = createSupabaseAdminClient();
    const tenantId = await ensureTenantId(session, client);
    const saved = await new SpecialtyProductRepository(
      client,
      env.SPECIALTY_CAMPAIGN_SLUG,
    ).save(input, { userId: session.user.id, tenantId });
    // The public specialty pool also has an independent five-second HTTP freshness limit.
    try {
      revalidateTag("specialty:discovery", { expire: 0 });
      revalidateTag("products:list", "max");
      revalidateTag("product:" + saved.productId, { expire: 0 });
    } catch {
      /* Saving has committed. */
    }
    return reply(saved, input.mode === "create" ? 201 : 200);
  } catch (error) {
    if (error instanceof AuthError)
      return reply(
        { error: error.status === 401 ? "Unauthorized" : "Forbidden" },
        error.status,
      );
    if (error instanceof ClaimBodyError)
      return reply({ error: "Invalid product request." }, error.status);
    if (error instanceof SpecialtyProductError)
      return reply(
        { error: error.message },
        ["revision_conflict", "stock_locked", "archived"].includes(error.code)
          ? 409
          : error.code === "invalid_product"
            ? 422
            : 503,
      );
    return reply(
      { error: "Specialty product management is temporarily unavailable." },
      503,
    );
  }
}
