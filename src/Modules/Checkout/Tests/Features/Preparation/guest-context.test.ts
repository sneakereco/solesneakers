import { createHmac } from "node:crypto";
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

test("independent initial proof names survive either arrival order", () => {
  const req = (cookie = "") =>
    new Request("https://example.invalid", { headers: { cookie } });
  const one = readOrIssueGuestContext(req(), secret),
    two = readOrIssueGuestContext(req(), secret);
  const [a, b] = [one, two].map((x) => x.setCookie!.split(";")[0]);
  expect(a.split("=")[0]).not.toBe(b.split("=")[0]);
  expect(readOrIssueGuestContext(req(a + "; " + b), secret).setCookie).toBeUndefined();
  const wrongName = a.split("=")[0] + "=" + b.split("=")[1];
  expect(readOrIssueGuestContext(req(wrongName), secret).contextHash).not.toBe(
    two.contextHash,
  );
});

test("reads the original fixed-name signed v1 proof and refuses unbounded collections", () => {
  const nonce = "a".repeat(64),
    mac = (domain: string) =>
      createHmac("sha256", secret)
        .update(domain + "\0" + nonce)
        .digest("hex");
  const cookie = "__Host-checkout-context=v1." + nonce + "." + mac("checkout-cookie-v1");
  const req = (header: string) =>
    new Request("https://example.invalid", { headers: { cookie: header } });
  expect(readOrIssueGuestContext(req(cookie), secret)).toEqual({
    contextHash: mac("checkout-owner-v1"),
  });
  const current = readOrIssueGuestContext(req(""), secret).setCookie!.split(";")[0];
  expect(
    readOrIssueGuestContext(
      req("__Host-checkout-context=" + current.split("=")[1]),
      secret,
    ).setCookie,
  ).toBeDefined();
  const tooMany = Array.from(
    { length: 17 },
    (_, i) => "__Host-checkout-context-" + i + "=invalid",
  ).join("; ");
  expect(() => readOrIssueGuestContext(req(tooMany), secret)).toThrow();
  expect(() =>
    readOrIssueGuestContext(req(cookie + "; x=" + "0".repeat(16400)), secret),
  ).toThrow();
});
