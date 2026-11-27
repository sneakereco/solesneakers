// app/admin/inventory/actions.ts
"use server";

import { createStaffCostReader } from "@/repositories/staff-cost-reader";
import { readInventoryData } from "./initial-read";

import { ProductService } from "@/services/product-service";
import type { Category, Condition } from "@/types/domain/product";

type StockStatus = "in_stock" | "archived";

interface InventoryFilters {
  q?: string;
  category?: Category | "all";
  condition?: Condition | "all";
  stockStatus?: StockStatus;
  page?: number;
  limit?: number;
}

export async function getInventoryProducts(filters: InventoryFilters = {}) {
  return readInventoryData(async (supabase, tenantId) => {
    const service = new ProductService(supabase, createStaffCostReader(supabase));

    const {
      q,
      category,
      condition,
      stockStatus = "in_stock",
      page = 1,
      limit = 100,
    } = filters;

    const result = await service.listProducts({
      q,
      category: category && category !== "all" ? [category] : undefined,
      condition: condition && condition !== "all" ? [condition] : undefined,
      limit,
      page,
      includeOutOfStock: true, // Admin needs to see all products
      stockStatus,
      tenantId,
      searchMode: "inventory",
    });

    return result;
  });
}
