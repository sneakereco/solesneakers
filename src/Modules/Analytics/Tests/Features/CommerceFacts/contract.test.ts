import { factParityCases } from "./fact-parity";
import {
  analyticsFactSchema,
  snapshotCatalogLabel,
} from "../../../Source/Features/CommerceFacts/contract";
import { base, payloads } from "./fixtures";

it.each(Object.entries(payloads))(
  "accepts a strict %s payload and rejects extra data",
  (kind, payload) => {
    const candidate = { ...base, kind, payload };
    expect(analyticsFactSchema.safeParse(candidate).success).toBe(true);
    expect(
      analyticsFactSchema.safeParse({
        ...candidate,
        payload: { ...payload, email: "buyer@example.com" },
      }).success,
    ).toBe(false);
  },
);

it.each([
  { ...base, payload: { ...payloads.order, discountCents: Number.MAX_SAFE_INTEGER + 1 } },
  { ...base, payload: { ...payloads.order, taxCents: -1 } },
  { ...base, payload: { ...payloads.order, paymentMethod: "4111111111111111" } },
  { ...base, payload: payloads.order, sessionId: base.factId },
  { ...base, payload: payloads.order, buyerKey: "buyer@example.com" },
  {
    ...base,
    kind: "line",
    payload: { ...payloads.line, productName: "buyer@example.com" },
  },
  { ...base, kind: "shipping_cost", payload: { adjustment: "credit", amountCents: -1 } },
  { ...base, kind: "line", payload: payloads.order },
])("rejects unsafe facts", (candidate) =>
  expect(analyticsFactSchema.safeParse(candidate).success).toBe(false),
);
it.each([
  "192.0.2.1",
  "(212) 555-0123",
  "Shop 212.555.0123",
  "Shop (212) 555-0123",
  "https://example.com",
])("rejects contact-like catalog labels %s", (productName) => {
  expect(
    analyticsFactSchema.safeParse({
      ...base,
      kind: "line",
      payload: { ...payloads.line, productName },
    }).success,
  ).toBe(false);
});

it.each(factParityCases)("$name", ({ candidate, valid }) => {
  expect(analyticsFactSchema.safeParse(candidate).success).toBe(valid);
});
it.each(factParityCases.filter((c) => c.key === "productName"))(
  "snapshots $name",
  ({ value, valid }) => {
    expect(snapshotCatalogLabel(value)).toBe(valid ? value : null);
  },
);
