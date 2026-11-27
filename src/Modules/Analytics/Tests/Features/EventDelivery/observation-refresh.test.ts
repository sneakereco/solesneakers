import { checkObservation } from "../../../Source/Features/EventDelivery/observation-refresh";

const columns = [
  "dataset_id",
  "order_id",
  "active",
  "visitor_id",
  "session_id",
  "device",
  "discovery",
  "purchase_session",
  "updated_at",
];
const updated = "2026-11-26T12:00:00.123456Z";
const source = {
  dataset_id: "sole-staging",
  order_id: "order",
  active: false,
  visitor_id: null,
  session_id: null,
  device: null,
  discovery: null,
  purchase_session: null,
  updated_at: updated,
};
const page = (results: unknown[][]) => ({
  columns: [...columns, "partition_rows"],
  hasMore: false,
  results,
});
test("idle source proves an empty partition, while extra/missing/revoked links invalidate it", () => {
  expect(checkObservation([], page([]), "links")).toBe("matched");
  const row = ["sole-staging", "order", false, null, null, null, null, null, updated, 1];
  expect(checkObservation([source], page([row]), "links")).toBe("matched");
  expect(checkObservation([], page([row]), "links")).toBe("retry");
  expect(checkObservation([source], page([]), "links")).toBe("retry");
  expect(
    checkObservation([source], page([row.map((v, i) => (i === 2 ? true : v))]), "links"),
  ).toBe("retry");
  expect(
    checkObservation(
      [source],
      page([row.map((v, i) => (i === 8 ? "2026-11-26T12:00:00.123455Z" : v))]),
      "links",
    ),
  ).toBe("retry");
});
test("oversized source and provider partitions request refinement", () => {
  expect(checkObservation(Array(501).fill(source), page([]), "links")).toBe("split");
  expect(checkObservation([], { ...page([]), hasMore: true }, "links")).toBe("split");
});
