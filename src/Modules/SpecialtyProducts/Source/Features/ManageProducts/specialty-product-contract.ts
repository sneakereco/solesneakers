import { z } from "zod";
const metadata = {
  name: z.string().trim().min(1).max(300),
  description: z.string().trim().max(10000).nullable().default(null),
  images: z
    .array(
      z
        .object({
          url: z
            .string()
            .url()
            .refine((value) => /^https?:\/\//i.test(value)),
          sortOrder: z.number().int().nonnegative(),
          isPrimary: z.boolean(),
        })
        .strict(),
    )
    .max(20),
  goLiveAt: z.string().datetime({ offset: true }),
  instructions: z.string().trim().max(4000).nullable().default(null),
};
const quantity = z.number().int().min(0).max(2147483647);
export const specialtyProductWriteSchema = z.discriminatedUnion("mode", [
  z.object({ ...metadata, mode: z.literal("create"), quantity }).strict(),
  z
    .object({
      ...metadata,
      mode: z.literal("update"),
      productId: z.string().uuid(),
      expectedRevision: z.number().int().positive(),
      quantity: quantity.optional(),
    })
    .strict(),
]);
export type SpecialtyProductWrite = z.infer<typeof specialtyProductWriteSchema>;
export type SpecialtyProductMetadata = Pick<
  SpecialtyProductWrite,
  "name" | "description" | "images" | "goLiveAt" | "instructions"
>;
export type SpecialtyProductDraft = SpecialtyProductMetadata & {
  productId: string;
  revision: number;
  remainingQuantity: number;
  hasClaims: boolean;
};
