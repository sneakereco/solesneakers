import {
  PurchaseProofs,
  projection,
  resizeUnits,
  subtractPurchasedPrefix,
  decodeUnits,
} from "../../../Source/Features/ManageBasket/purchase-capture";

const id = "22aa02e4-e45b-4dda-8a2b-caf24339bbd5";
const original = {
  id,
  high: "5",
  ranges: [
    ["0", "2"],
    ["4", "5"],
  ] as [string, string][],
};

test("purchased prefix spans original holes and never advances over units already removed", () => {
  const live = {
    id,
    high: "8",
    ranges: [
      ["1", "2"],
      ["4", "5"],
      ["7", "8"],
    ] as [string, string][],
  };
  expect(subtractPurchasedPrefix(live, original, 2)).toEqual({
    ...live,
    ranges: [
      ["4", "5"],
      ["7", "8"],
    ],
  });
  const first = subtractPurchasedPrefix(live, original, 3);
  expect(first.ranges).toEqual([["7", "8"]]);
  expect(subtractPurchasedPrefix(first, original, 3)).toEqual(first);
});
test("append and trim past safe-integer offsets preserve allocation identity without per-unit storage", () => {
  const units = {
    id,
    high: "9007199254740994",
    ranges: [["9007199254740993", "9007199254740994"]] as [string, string][],
  };
  const million = resizeUnits(units, 1, 1000001);
  expect(million.ranges).toEqual([["9007199254740993", "9007199255740994"]]);
  const trimmed = resizeUnits(million, 1000001, 1);
  expect(resizeUnits(trimmed, 1, 2).ranges).toEqual([
    ["9007199254740993", "9007199254740994"],
    ["9007199255740994", "9007199255740995"],
  ]);
});
test.each([
  { ...original, high: "4" },
  {
    ...original,
    ranges: [
      ["0", "2"],
      ["1", "2"],
    ],
  },
  {
    ...original,
    ranges: [
      ["0", "1"],
      ["1", "3"],
    ],
  },
  { ...original, ranges: [["00", "3"]] },
  { ...original, high: "9".repeat(65) },
  { ...original, id: "bad" },
])("malformed unit evidence cannot match", (value) =>
  expect(decodeUnits(value, 3)).toBeNull(),
);

import { decodeSavedBasket } from "../../../Source/Features/ManageBasket/decode-saved-basket";

test("public basket rows omit private stored lineage", () => {
  const item = {
    productId: "x",
    variantId: "v",
    quantity: 1,
    priceCents: 10,
    name: "Shoe",
    brand: "Sole",
    sizeLabel: "10",
    titleDisplay: "Shoe",
    imageUrl: "/shoe.jpg",
  };
  const raw = JSON.stringify([
    {
      ...item,
      _cartUnits: {
        id: "22aa02e4-e45b-4dda-8a2b-caf24339bbd5",
        high: "1",
        ranges: [["0", "1"]],
      },
    },
  ]);
  expect(decodeSavedBasket(raw).items).toEqual([item]);
});

test("unit and projection parsing honor proof bounds independent of ordinary storage", () => {
  const ranges = Array.from({ length: 4096 }, (_, i) => [
    String(2 * i),
    String(2 * i + 1),
  ]);
  expect(decodeUnits({ id, high: "8192", ranges }, 4096)).not.toBeNull();
  expect(
    decodeUnits({ id, high: "8193", ranges: [...ranges, ["8192", "8193"]] }, 4097),
  ).toBeNull();
  const large = "9".repeat(64);
  expect(
    decodeUnits({ id, high: large, ranges: [[String(BigInt(large) - 1n), large]] }, 1),
  ).not.toBeNull();
  const lines = Array.from({ length: 1024 }, (_, i) => ({
    productId: id,
    variantId: "22aa02e4-e45b-4dda-8a2b-" + String(i).padStart(12, "0"),
    quantity: 1,
  }));
  expect(projection(lines)).toHaveLength(1024);
  expect(projection([...lines, { ...lines[0], variantId: id }])).toBeUndefined();
  expect(
    projection([{ ...lines[0], quantity: Number.MAX_SAFE_INTEGER + 1 }]),
  ).toBeUndefined();
});

test("association parser bounds serialized UTF-16 length before decoding", () => {
  let raw = "[]".padEnd(2097152);
  const area = { getItem: () => raw } as unknown as Storage;
  expect(PurchaseProofs.read(area, "proof", undefined, () => true)?.records).toEqual([]);
  raw += " ";
  expect(PurchaseProofs.read(area, "proof", undefined, () => true)).toBeUndefined();
});
