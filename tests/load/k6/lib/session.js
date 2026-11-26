import crypto from "k6/crypto";
export function uuid() {
  const bytes = new Uint8Array(crypto.randomBytes(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const text = Array.from(bytes, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`;
}
export function logicalSession(config, slot, generation, identity) {
  const products = config.fixtures.products.filter((x) => !x.hot),
    product = products[slot % products.length];
  const id = uuid();
  return {
    runId: config.plan.runId,
    slot,
    generation,
    sessionId: id,
    deviceId: uuid(),
    idempotencyKey: uuid(),
    email: identity?.accountId
      ? identity.email
      : `guest-${slot}-${generation}-${id}@${config.plan.runId}.load.test`,
    fulfillment: slot % 5 === 0 ? "pickup" : "ship",
    address: config.fixtures.addresses[0],
    productId: product.id,
    items: [{ productId: product.id, variantId: product.variantId, quantity: 1 }],
    search: product.name,
  };
}
