import { isAuthorizedCronRequest } from "@/lib/http/cron-auth";

describe("isAuthorizedCronRequest", () => {
  const secret = "a-secure-cron-secret-that-is-long-enough";

  it("accepts only the exact bearer secret", () => {
    expect(
      isAuthorizedCronRequest(
        new Request("https://shop.example.com/api/cron/expire-checkouts", {
          headers: { authorization: `Bearer ${secret}` },
        }),
        secret,
      ),
    ).toBe(true);

    expect(
      isAuthorizedCronRequest(
        new Request("https://shop.example.com/api/cron/expire-checkouts", {
          headers: { authorization: "Bearer wrong" },
        }),
        secret,
      ),
    ).toBe(false);
    expect(
      isAuthorizedCronRequest(
        new Request("https://shop.example.com/api/cron/expire-checkouts"),
        secret,
      ),
    ).toBe(false);
  });
});
