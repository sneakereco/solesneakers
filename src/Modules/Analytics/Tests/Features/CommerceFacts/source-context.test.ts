import {
  buildSourceContext,
  validateCheckoutTracking,
} from "@/Modules/Analytics/Source/Features/CommerceFacts/source-context";
import { createBuyerKey } from "@/Modules/Analytics/Source/Features/CommerceFacts/buyer-key";

const secret = "isolated-testing-analytics-key-123456789";
const email = "customer@example.com";
const buyerKey = createBuyerKey({ normalizedEmail: email }, secret);
const id = "34a328d0-4cfc-4ca7-a9f8-ade895f43c33";
const tracking = {
  receiptId: id,
  visitorId: buyerKey,
  sessionId: id,
  device: "desktop",
  discovery: null,
  purchaseSession: null,
} as const;
const deps = {
  consent: () => Promise.resolve({ choice: "accepted", receiptId: id } as const),
  identity: () => Promise.resolve({ buyerKey }),
};

it("drops optional linkage when a consent dependency stalls", async () => {
  jest.useFakeTimers();
  try {
    const waiting = validateCheckoutTracking(tracking, {
      ...deps,
      consent: () => new Promise(() => {}),
    });
    await jest.advanceTimersByTimeAsync(1000);
    await expect(waiting).resolves.toBeNull();
  } finally {
    jest.useRealTimers();
  }
});
it("freezes server-calculated components without raw identity", () => {
  const totals = {
    subtotalCents: 2500,
    shippingCents: 250,
    taxCents: 310,
    totalCents: 3060,
  };
  const input = {
    datasetId: "sole-staging",
    buyerEmail: email,
    identitySecret: secret,
    totals,
    tracking: null,
  };
  expect(buildSourceContext(input)).toEqual({
    datasetId: "sole-staging",
    buyerKey,
    totals,
    tracking: null,
  });
  expect(buildSourceContext({ ...input, identitySecret: null }).buyerKey).toBeNull();
});
it("requires an active matching preference and a currently verified identified visitor", async () => {
  await expect(validateCheckoutTracking(tracking, deps)).resolves.toEqual(tracking);
  await expect(
    validateCheckoutTracking(tracking, {
      ...deps,
      identity: () => Promise.reject(new Error("offline")),
    }),
  ).resolves.toBeNull();
  await expect(
    validateCheckoutTracking(tracking, {
      ...deps,
      identity: () => Promise.resolve(null),
    }),
  ).resolves.toBeNull();
  await expect(
    validateCheckoutTracking(tracking, {
      ...deps,
      consent: () => Promise.resolve({ choice: "declined" }),
    }),
  ).resolves.toBeNull();
  await expect(
    validateCheckoutTracking({ ...tracking, consent: true }, deps),
  ).resolves.toBeNull();
  await expect(
    validateCheckoutTracking({ ...tracking, discovery: { source: "5555550123" } }, deps),
  ).resolves.toBeNull();
});
