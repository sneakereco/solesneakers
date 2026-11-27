import { randomUUID } from "node:crypto";
import { verifyJourney } from "../../../Source/Features/EventDelivery/journey-evidence";
import { payloads } from "../CommerceFacts/fixtures";

jest.mock("server-only", () => ({}), { virtual: true });

const sessionA = randomUUID();
const orderB = randomUUID();
const refundB = payloads.refund.refundId;
const input = {
  sessionId: sessionA,
  orderId: orderB,
  refundId: refundB,
  start: "2026-11-25T17:00:00Z",
  end: "2026-11-25T20:00:00Z",
  browserClosedAt: "2026-11-25T18:00:00Z",
  events: ["product_viewed", "product_added_to_cart", "checkout_started"].map((name) => ({
    name,
    id: randomUUID(),
  })),
};
const provider = {
  columns: ["event_name", "event_uuid"],
  hasMore: false,
  results: input.events.map(({ name, id }) => [name, id]),
};
const source = {
  revisions: 2,
  publications: [
    { kind: "order", id: orderB, payload: payloads.order },
    { kind: "refund", id: refundB, payload: payloads.refund },
  ].map(({ kind, id, payload }) => ({
    publicationId: randomUUID(),
    fact: {
      kind,
      factId: kind + ":" + id,
      orderId: orderB,
      revision: 1,
      recordedAt: "2026-11-25T19:00:00Z",
      payload,
    },
  })),
};

it("rejects session A events paired with complete order B and refund B facts", () => {
  expect(() => verifyJourney(input, provider, source, false)).toThrow(
    "Journey purchase link unavailable",
  );
});

it.each([null, undefined, "true"])(
  "fails closed on unverified link result %p",
  (link) => {
    expect(() => verifyJourney(input, provider, source, link)).toThrow(
      "Journey purchase link unavailable",
    );
  },
);

it("accepts an exact active session/order link and complete journey evidence", () => {
  expect(() => verifyJourney(input, provider, source, true)).not.toThrow();
});

it("still requires the source's analytics refund UUID with an active link", () => {
  expect(() =>
    verifyJourney({ ...input, refundId: randomUUID() }, provider, source, true),
  ).toThrow("Journey order/refund unavailable");
});
