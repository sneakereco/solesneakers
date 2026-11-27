import payloads from "./payloads.json";
const id = "ad27ced8-5b47-4201-9d20-7af9a41f60a6";
const at = "2026-11-25T18:00:00Z";
const base = {
  datasetId: "sole-staging-v2",
  factId: id,
  revision: 1,
  kind: "order",
  effectiveAt: at,
  recordedAt: at,
  currency: "USD",
  buyerKey: null,
  orderId: id,
} as const;
export { at, base, id, payloads };
