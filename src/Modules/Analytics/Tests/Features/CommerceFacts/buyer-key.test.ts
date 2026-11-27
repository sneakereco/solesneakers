import { createHash } from "node:crypto";

import { createBuyerKey } from "../../../Source/Features/CommerceFacts/buyer-key";

jest.mock("server-only", () => ({}), { virtual: true });

const secret = "sole-private-identity-fixture-abcdefghijkl";

it("groups the same normalized guest and verified account email", () => {
  const guest = createBuyerKey({ normalizedEmail: "  Buyer@Example.COM  " }, secret);
  const account = createBuyerKey({ normalizedEmail: "buyer@example.com" }, secret);

  expect(guest).toBe(account);
  expect(guest).toBe(
    "sole-buyer:v1:73aba9f0cf7cf2358458b41cf148d48d47416b6711076c145a4e9c4a9b7cebb2",
  );
  expect(guest).not.toContain("buyer@example.com");
  expect(guest).not.toContain(
    createHash("sha256").update("buyer@example.com").digest("hex"),
  );
});

it("keeps plus-tagged emails and differently scoped secrets distinct", () => {
  const base = createBuyerKey({ normalizedEmail: "buyer@example.com" }, secret);
  expect(createBuyerKey({ normalizedEmail: "buyer+shop@example.com" }, secret)).not.toBe(
    base,
  );
  expect(
    createBuyerKey({ normalizedEmail: "buyer@example.com" }, `${secret}-other-store`),
  ).not.toBe(base);
});

it("rejects empty identity input and missing secret", () => {
  expect(() => createBuyerKey({ normalizedEmail: " " }, secret)).toThrow();
  expect(() => createBuyerKey({ normalizedEmail: "buyer@example.com" }, "")).toThrow();
});
