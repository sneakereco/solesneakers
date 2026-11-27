import { getSameOriginAuthDestination } from "@/lib/auth/navigate-after-auth";

it.each([
  ["/store?category=accessories", "/store?category=accessories"],
  ["/auth/2fa/challenge", "/auth/2fa/challenge"],
  ["https://shop.test/account#orders", "/account#orders"],
  ["https://shop.test//other.test/store", "/"],
  ["https://shop.test/\\other.test/store", "/"],
  ["https://other.test/store", "/"],
  ["//other.test/store", "/"],
  ["/\\other.test/store", "/"],
  ["javascript:alert(1)", "/"],
  [null, "/"],
  [{ destination: "/store" }, "/"],
])("constrains authentication destination %p to this site", (input, expected) => {
  expect(getSameOriginAuthDestination(input, "https://shop.test")).toBe(expected);
});
