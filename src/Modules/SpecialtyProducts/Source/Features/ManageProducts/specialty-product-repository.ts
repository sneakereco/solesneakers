import { z } from "zod";
import type { AdminSupabaseClient } from "@/lib/supabase/service-role";
import type { Database } from "@/types/db/database.types";
import {
  specialtyProductWriteSchema,
  type SpecialtyProductWrite,
} from "./specialty-product-contract";

export type SpecialtyProductErrorCode =
  | "revision_conflict"
  | "stock_locked"
  | "archived"
  | "invalid_product"
  | "unavailable";
export class SpecialtyProductError extends Error {
  constructor(readonly code: SpecialtyProductErrorCode) {
    super(
      code === "revision_conflict"
        ? "This product changed. Refresh and try again."
        : code === "stock_locked"
          ? "Quantity cannot be changed after a successful claim."
          : code === "archived"
            ? "Restore the archived product before editing."
            : code === "invalid_product"
              ? "Check the specialty product details."
              : "Specialty product management is temporarily unavailable.",
    );
    this.name = "SpecialtyProductError";
  }
}
const savedProductSchema = z
  .object({ productId: z.string().uuid(), revision: z.number().int().positive() })
  .strict();
export class SpecialtyProductRepository {
  constructor(
    private readonly client: AdminSupabaseClient,
    private readonly campaignSlug = "black-friday-2026",
  ) {}
  async save(
    input: SpecialtyProductWrite,
    actor: { userId: string; tenantId: string },
  ): Promise<{ productId: string; revision: number }> {
    const parsed = specialtyProductWriteSchema.parse(input);
    const args = {
      p_product_id: parsed.mode === "update" ? parsed.productId : null,
      p_input: { ...parsed, campaignSlug: this.campaignSlug },
      p_actor_id: actor.userId,
      p_compatibility_tenant_id: actor.tenantId,
    };
    // Postgres accepts NULL for create; generated function args do not model that.
    const { data, error } = await this.client.rpc(
      "save_specialty_product",
      args as Database["public"]["Functions"]["save_specialty_product"]["Args"],
    );
    if (error) {
      const message = error.message;
      throw new SpecialtyProductError(
        message.includes("specialty_revision_conflict")
          ? "revision_conflict"
          : message.includes("specialty_stock_locked_after_claim")
            ? "stock_locked"
            : message.includes("specialty_product_archived")
              ? "archived"
              : /specialty_invalid_|specialty_category_immutable/.test(message)
                ? "invalid_product"
                : "unavailable",
      );
    }
    const saved = savedProductSchema.safeParse(data);
    if (!saved.success) throw new SpecialtyProductError("unavailable");
    return saved.data;
  }
}
