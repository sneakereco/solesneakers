import {
  readOrIssueGuestContext,
  verifyGuestPreparationReuse,
} from "@/Modules/Checkout/Source/Features/Preparation/guest-context";

const secret = "local-checkout-fixture-signing-secret";
test("quote-issued context survives a lost preparation reply without storing the cookie on the order", () => {
  const req = (cookie?: string) =>
    new Request("https://example.invalid", { headers: cookie ? { cookie } : {} });
  const first = readOrIssueGuestContext(req(), secret);
  expect(first.setCookie).toMatch(/; Secure/);
  expect(first.setCookie).toMatch(/; HttpOnly/);
  expect(first.setCookie).toMatch(/; SameSite=Lax/);
  const cookie = first.setCookie!.split(";")[0];
  expect(cookie).not.toContain(first.contextHash);
  expect(readOrIssueGuestContext(req(cookie), secret)).toEqual({
    contextHash: first.contextHash,
  });
  const order = { userId: null, guestContextHash: first.contextHash };
  expect(verifyGuestPreparationReuse(order, first.contextHash)).toBe(true);
  const other = readOrIssueGuestContext(req(), secret);
  expect(verifyGuestPreparationReuse(order, other.contextHash)).toBe(false);
  expect(
    verifyGuestPreparationReuse({ ...order, guestContextHash: null }, first.contextHash),
  ).toBe(false);
  expect(readOrIssueGuestContext(req(cookie + "x"), secret).contextHash).not.toBe(
    first.contextHash,
  );
});
