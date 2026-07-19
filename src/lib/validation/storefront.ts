// src/lib/validation/storefront.ts
import { z } from "zod";

const stringList = z.array(z.string().trim().min(1)).default([]);

export const storeProductsQuerySchema = z
  .object({
    q: z.string().trim().min(1).optional(),
    category: stringList,
    brandIds: stringList,
    modelIds: stringList,
    sizeIds: stringList,
    condition: stringList,
    priceMinCents: z.number().int().nonnegative().optional(),
    priceMaxCents: z.number().int().nonnegative().optional(),
    sort: z
      .enum([
        "relevance",
        "newest",
        "oldest",
        "price_asc",
        "price_desc",
        "name_asc",
        "name_desc",
      ])
      .default("newest"),
    page: z.number().int().positive().finite().default(1),
    limit: z.number().int().positive().finite().max(100).default(20),
    stockStatus: z.enum(["in_stock", "out_of_stock", "all"]).default("in_stock"),
  })
  .strict();
