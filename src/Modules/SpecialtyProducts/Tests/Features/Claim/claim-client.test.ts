import {
  validateClaimEligibility,
  submitClaim,
  recoverClaim,
  settleClaimAttempt,
  ClaimClientError,
} from "@/Modules/SpecialtyProducts/Source/Features/Claim/claim-client";
const id = "11111111-1111-4111-8111-111111111111";
const credentials = {
  attemptId: "22222222-2222-4222-8222-222222222222",
  recoverySecret: "a".repeat(64),
};
const input = {
  ...credentials,
  productId: id,
  instagramHandle: "sole",
  address: {
    line1: "123 MAIN ST",
    line2: null,
    city: "COLUMBIA",
    state: "SC",
    postalCode: "29201",
    country: "US" as const,
  },
};
const originalFetch = global.fetch;
test("field validation errors remain actionable rather than a provider outage", async () => {
  global.fetch = jest.fn().mockResolvedValue(
    Response.json(
      {
        status: "invalid",
        fields: { instagramHandle: "Enter a valid Instagram handle." },
      },
      { status: 422 },
    ),
  );
  expect(
    await validateClaimEligibility({
      productId: id,
      instagramHandle: "@@bad",
      address: input.address,
    }),
  ).toEqual({
    status: "invalid",
    fields: { instagramHandle: "Enter a valid Instagram handle." },
  });
});
afterEach(() => {
  global.fetch = originalFetch;
  jest.useRealTimers();
});
test("recovery sends only credentials in a private POST body, never a URL", async () => {
  const fetcher = jest
    .fn()
    .mockResolvedValue(
      Response.json({ status: "pending", retryAfterSeconds: 2 }, { status: 202 }),
    );
  global.fetch = fetcher;
  expect(await recoverClaim({ ...credentials, productId: id } as never)).toEqual({
    status: "unknown",
    retryAfterSeconds: 2,
  });
  expect(fetcher.mock.calls[0][0]).toBe("/api/specialty/claims/result");
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual(credentials);
  expect(fetcher.mock.calls[0][1].cache).toBe("no-store");
});
test.each([429, 503])("temporary HTTP %s is not a definitive loss", async (status) => {
  global.fetch = jest
    .fn()
    .mockResolvedValue(
      Response.json(
        { status: "unavailable" },
        { status, headers: { "Retry-After": "4" } },
      ),
    );
  await expect(submitClaim(input)).rejects.toMatchObject({ retryAfterSeconds: 4 });
});
test("malformed results cannot masquerade as a winning receipt", async () => {
  global.fetch = jest
    .fn()
    .mockResolvedValue(
      Response.json({ result: { status: "won", receipt: "fake" }, replayed: false }),
    );
  await expect(submitClaim(input)).rejects.toBeInstanceOf(ClaimClientError);
});
test("eligibility corrections remain distinct from validated proofs", async () => {
  global.fetch = jest.fn().mockResolvedValue(
    Response.json({
      status: "correction_required",
      address: input.address,
      correctionToken: "correction",
    }),
  );
  expect(
    await validateClaimEligibility({
      productId: id,
      instagramHandle: input.instagramHandle,
      address: input.address,
    }),
  ).toEqual({
    status: "correction_required",
    address: input.address,
    correctionToken: "correction",
  });
});
test("lost submission response recovers the committed decision without creating another attempt", async () => {
  const bodies: unknown[] = [];
  global.fetch = jest.fn((url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    if (url === "/api/specialty/claims")
      return Promise.reject(new Error("response lost"));
    return Promise.resolve(
      Response.json({ result: { status: "sold_out" }, replayed: true }),
    );
  });
  expect(await settleClaimAttempt(credentials, input)).toEqual({
    result: { status: "sold_out" },
    replayed: true,
  });
  expect(bodies).toEqual([input, credentials]);
});
test("uncertain recovery stops automatically at 30 seconds and preserves unknown outcome", async () => {
  jest.useFakeTimers();
  global.fetch = jest
    .fn()
    .mockResolvedValue(
      Response.json({ status: "pending", retryAfterSeconds: 1 }, { status: 202 }),
    );
  const pending = settleClaimAttempt(credentials, null);
  await jest.advanceTimersByTimeAsync(30001);
  expect(await pending).toEqual({ status: "unknown", retryAfterSeconds: 1 });
});
