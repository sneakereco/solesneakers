export function inventoryViolations(variants) {
  return variants
    .filter(
      (v) =>
        v.stock < 0 ||
        v.active < 0 ||
        v.consumed < 0 ||
        v.stock + v.active + v.consumed !== v.initial,
    )
    .map(() => "Inventory conservation/oversell violation");
}
export async function collectInventoryOutcomes(db, products) {
  return (
    await db.query(
      `select v.id,v.stock,coalesce(sum(r.quantity) filter(where r.status='active'),0)::int active,coalesce(sum(r.quantity) filter(where r.status='consumed'),0)::int consumed from public.product_variants v left join public.inventory_reservations r on r.variant_id=v.id where v.id=any($1::uuid[]) group by v.id`,
      [products.map((x) => x.variantId)],
    )
  ).rows.map((row) => ({
    ...row,
    initial: products.find((x) => x.variantId === row.id).stock,
    hot: products.find((x) => x.variantId === row.id).hot,
  }));
}
export async function collectDurableOutcomes(clients, plan, journal) {
  if (journal.targetDigest !== plan.targetDigest)
    throw Error("Invariant target identity mismatch");
  const products = journal
    .records()
    .filter((x) => x.kind === "catalog" && x.status !== "deleted")
    .map((x) => x.data);
  const ids = products.map((x) => x.variantId),
    db = clients.db;
  const variants = await collectInventoryOutcomes(db, products);
  const orders = (
    await db.query(
      `select o.id,o.status,o.square_order_id,round(o.total*100)::int "totalCents",round(o.shipping*100)::int "shippingCents",round(o.tax_amount*100)::int "taxCents",round(sum(i.line_total)*100)::int "itemCents",count(*)::int "itemCount",bool_and(i.product_name is not null and i.variant_sku is not null and i.unit_price is not null) "hasSnapshot" from public.orders o join public.order_items i on i.order_id=o.id where o.id in(select order_id from public.order_items where variant_id=any($1::uuid[])) group by o.id`,
      [ids],
    )
  ).rows;
  const captures = [];
  for (let offset = 0; offset < orders.length; offset += 100) {
    const group = orders.slice(offset, offset + 100).filter((x) => x.square_order_id);
    if (!group.length) continue;
    const response = await clients.control("status", {
      runId: plan.runId,
      squareOrderIds: group.map((x) => x.square_order_id),
    });
    for (const ledger of response.ledgers)
      for (const payment of ledger.payments)
        captures.push({ ...payment, orderId: ledger.localOrderId });
  }
  const acceptedOrderIds = [...(clients.acceptedOrderIds ?? [])];
  let cursor = 0;
  do {
    const page = await clients.control("status", { runId: plan.runId, cursor });
    acceptedOrderIds.push(...(page.ownedOrderIds ?? []));
    cursor = page.nextCursor;
    if (cursor > 1000000) throw Error("Owned outcome registry exceeds fixture budget");
  } while (cursor !== null && cursor !== undefined);
  return {
    variants,
    orders,
    captures,
    acceptedOrderIds,
    claims: null,
    receiptEvidence: orders.every((x) => x.hasSnapshot),
    coverage: clients.coverage ?? [],
  };
}
export function assertRunInvariants(report, plan) {
  const reasons = [],
    unmet = [];
  if (!report?.variants || !report.orders || !report.captures)
    return { status: "unmet", reasons: ["Durable database/provider evidence missing"] };
  reasons.push(...inventoryViolations(report.variants));
  const captureIds = new Map(),
    paidOrders = new Map();
  for (const capture of report.captures) {
    if (captureIds.has(capture.id)) {
      const previous = captureIds.get(capture.id);
      if (
        previous.orderId !== capture.orderId ||
        previous.totalCents !== capture.totalCents
      )
        reasons.push("Provider payment has contradictory durable ownership");
      continue;
    }
    captureIds.set(capture.id, capture);
    if (capture.status !== "COMPLETED") continue;
    const count = (paidOrders.get(capture.orderId) ?? 0) + 1;
    paidOrders.set(capture.orderId, count);
    if (count > 1) reasons.push("Duplicate capture for one order");
    const order = report.orders.find((o) => o.id === capture.orderId);
    if (
      !order ||
      ![
        "paid",
        "shipped",
        "ready_for_pickup",
        "picked_up",
        "completed",
        "delivered",
      ].includes(order.status)
    )
      reasons.push("Captured payment has no durable accepted order");
    if (order && order.totalCents !== capture.totalCents)
      reasons.push("Capture/order totals mismatch");
  }
  for (const order of report.orders) {
    if (
      order.itemCount < 1 ||
      order.totalCents !== order.itemCents + order.shippingCents + order.taxCents
    )
      reasons.push("Order/item totals mismatch");
    if (order.status === "paid" && !paidOrders.has(order.id))
      reasons.push("Paid order has no capture");
  }
  for (const id of report.acceptedOrderIds ?? [])
    if (!report.orders.some((x) => x.id === id))
      reasons.push("Accepted response has no durable order");
  if (!report.receiptEvidence) unmet.push("Receipt snapshot evidence missing");
  if (["rush", "rush-worst"].includes(plan.profile)) {
    const hotUnits = report.variants
      .filter((x) => x.hot)
      .reduce((n, x) => n + x.consumed, 0);
    if (hotUnits !== plan.hotStock)
      reasons.push(
        "All-eligible successful-payment rush did not produce exact stock winners",
      );
  }
  if (plan.profile === "claim-rush" && !report.claims)
    unmet.push(
      "Actual specialty claim contract and durable eligibility evidence missing",
    );
  return {
    status: reasons.length ? "fail" : unmet.length ? "unmet" : "pass",
    reasons: [...new Set([...reasons, ...unmet])],
    stockWinners: report.variants
      .filter((x) => x.hot)
      .reduce((n, x) => n + x.consumed, 0),
    captureCount: captureIds.size,
  };
}
