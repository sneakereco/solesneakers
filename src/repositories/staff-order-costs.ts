import type { StaffCostReader } from "./staff-cost-reader";

export async function hydrateStaffOrderCosts<
  T extends { items: { id: string; variant: { id: string } | null }[] },
>(orders: T[], costs: StaffCostReader | undefined) {
  if (!costs) throw new Error("Staff cost access required");
  const items = orders.flatMap((order) => order.items);
  const [line, variant] = await Promise.all([
    costs.lines(items.map((item) => item.id)),
    costs.variants(items.flatMap((item) => (item.variant ? [item.variant.id] : []))),
  ]);
  return orders.map((order) => ({
    ...order,
    items: order.items.map((item) => {
      const current = item.variant && variant(item.variant.id);
      return {
        ...item,
        unit_cost: line(item.id).unit_cost,
        variant:
          item.variant && current
            ? {
                ...item.variant,
                unit_cost_cents:
                  current.unit_cost_recorded || current.unit_cost_cents > 0
                    ? current.unit_cost_cents
                    : null,
              }
            : null,
      };
    }),
  }));
}
