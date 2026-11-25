import { randomUUID, randomBytes, createHash } from "node:crypto";
import { canonicalJson } from "../shared/contracts.mjs";

export async function seedFixtures(target, plan, clients, journal) {
  const bundle = {
    runId: plan.runId,
    accounts: [],
    products: [],
    addresses: [],
    capabilityGaps: [],
  };
  const registered = [];
  async function ensure(kind, key, make, client) {
    const prior = journal.records().find((x) => x.kind === kind && x.key === key);
    const data = prior?.data ?? make();
    await journal.intent(kind, key, data);
    const actual = await client.ensure(data);
    if (actual.id !== data.id || actual.runId !== plan.runId)
      throw Error("Seed ownership mismatch");
    await journal.commit(kind, key, actual);
    return { ...data, ...actual };
  }
  for (let i = 0; i < plan.accountPoolSize; i++) {
    const account = await ensure(
      "account",
      String(i),
      () => ({
        id: randomUUID(),
        runId: plan.runId,
        email: `account${i}@${plan.runId}.load.test`,
        password: randomBytes(32).toString("base64url"),
      }),
      clients.accounts,
    );
    bundle.accounts.push(account);
    registered.push(
      { kind: "account", id: account.id, slot: 0 },
      { kind: "email", id: account.email, slot: 0 },
    );
  }
  const ordinaryCount = 20;
  for (let i = 0; i <= ordinaryCount; i++) {
    const product = await ensure(
      "catalog",
      String(i),
      () => ({
        id: randomUUID(),
        variantId: randomUUID(),
        brandId: randomUUID(),
        sizeId: randomUUID(),
        imageId: randomUUID(),
        runId: plan.runId,
        hot: i === ordinaryCount,
        name: `Load ${plan.runId} ${i}`,
        stock:
          i === ordinaryCount
            ? plan.hotStock
            : Math.ceil(plan.ordinaryStockUnits / ordinaryCount),
        priceCents: 1000,
        sku: `load-${plan.runId}-${i}`,
      }),
      clients.catalog,
    );
    bundle.products.push(product);
    registered.push(
      { kind: "product", id: product.id, slot: 0 },
      { kind: "variant", id: product.variantId, slot: 0 },
    );
  }
  // One synthetic, routable-format address per active slot, without contact PII.
  // Real validator still normalizes and validates the HTTP request.
  const address = {
    name: "Load Buyer",
    phone: "2025550100",
    line1: "1 Test Avenue",
    line2: "",
    city: "Columbia",
    state: "SC",
    postalCode: "29201",
    country: "US",
  };
  bundle.addresses.push(address);
  const physical = {
    line1: address.line1.trim().toUpperCase(),
    line2: "",
    city: address.city.trim().toUpperCase(),
    state: "SC",
    postalCode: "29201",
    country: "US",
  };
  // Server uses shippingAddressKey (lowercase normalized JSON); keep one
  // golden contract test at the boundary rather than trusting prose here.
  const addressKey = JSON.stringify([
    physical.line1,
    "",
    physical.city,
    "SC",
    "29201",
    "US",
  ]);
  registered.push({
    kind: "address",
    id: createHash("sha256").update(canonicalJson(addressKey)).digest("hex"),
    slot: 0,
  });
  for (let offset = 0; offset < registered.length; offset += 100)
    await clients.register(registered.slice(offset, offset + 100));
  if (target.requiredCapabilities?.includes("specialty-claims"))
    bundle.capabilityGaps.push(
      "specialty-claims requires the deployed campaign contract; ordinary fixtures remain available",
    );
  return bundle;
}
